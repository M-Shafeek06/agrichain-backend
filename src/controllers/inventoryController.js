const RetailerInventory = require("../models/RetailerInventory");
const SaleLog = require("../models/SaleLog");
const { generateSaleHash } = require("../services/saleIntegrityService");
const updateTrustScore = require("../utils/updateTrustScore");
const { money, mul, sub, add } = require("../utils/money");

/* =====================================================
   🔹 GET RETAILER INVENTORY
===================================================== */

const getRetailerInventory = async (req, res) => {
    try {
        const retailerId = req.headers["x-retailer-id"];

        if (!retailerId) {
            return res.status(400).json({
                message: "Retailer ID missing in request header"
            });
        }

        const inventory = await RetailerInventory.aggregate([

            /* 🔹 MATCH RETAILER */
            {
                $match: { retailerId }
            },

            /* 🔥 JOIN INVOICE (NEW FIX) */
            {
                $lookup: {
                    from: "invoices",
                    localField: "invoiceId",
                    foreignField: "invoiceId",
                    as: "invoice"
                }
            },
            {
                $addFields: {
                    invoice: { $arrayElemAt: ["$invoice", 0] }
                }
            },

            /* 🔹 JOIN PRODUCE */
            {
                $lookup: {
                    from: "produces",
                    localField: "batchId",
                    foreignField: "batchId",
                    as: "produce"
                }
            },

            /* 🔹 ADD FIELDS */
            {
                $addFields: {
                    cropName: {
                        $ifNull: [
                            { $arrayElemAt: ["$produce.cropName", 0] },
                            "Unknown Crop"
                        ]
                    },

                    /* 🔥 OPTIONAL: expose invoice fields */
                    transportChargeFromInvoice: "$invoice.charge",
                    transportDate: "$invoice.transportDate"
                }
            },

            /* 🔹 CLEAN OUTPUT */
            {
                $project: {
                    produce: 0,
                    __v: 0
                }
            },

            /* 🔹 SORT */
            {
                $sort: { createdAt: -1 }
            }
        ]);

        res.json(inventory);

    } catch (err) {
        console.error("Inventory fetch error:", err.message);
        res.status(500).json({
            message: "Failed to fetch inventory"
        });
    }
};


/* =====================================================
   🔹 RECORD SALE (B2C)
===================================================== */

const recordSale = async (req, res) => {
    try {
        const retailerId = req.headers["x-retailer-id"];
        const { inventoryId, quantitySold } = req.body;

        if (!retailerId) {
            return res.status(400).json({ error: "Retailer ID missing" });
        }

        const qty = parseFloat(quantitySold);

        if (!inventoryId || !qty || qty <= 0) {
            return res.status(400).json({
                error: "Invalid inventory ID or sale quantity"
            });
        }

        /* ================= ATOMIC UPDATE ================= */

        const inventory = await RetailerInventory.findOne({
            inventoryId,
            retailerId,
            remainingQuantity: { $gte: qty },
            integrityStatus: { $ne: "TAMPERED" }
        });

        if (!inventory) {
            return res.status(400).json({
                error: "Stock not available or inventory tampered"
            });
        }

        /* 🔥 ADD THIS BLOCK */
        const Produce = require("../models/Produce");

        const produce = await Produce.findOne({ batchId: inventory.batchId });

        if (produce?.verificationStatus !== "APPROVED") {
            return res.status(400).json({
                error: "Cannot sell rejected product"
            });
        }

        // 🔹 ROUND FUNCTION
        const round = (num) => Math.round(num * 100) / 100;

        // 🔹 APPLY SAFE CALCULATION
        inventory.soldQuantity = round(inventory.soldQuantity + qty);
        inventory.remainingQuantity = round(inventory.quantity - inventory.soldQuantity);

        if (inventory.remainingQuantity <= 0) {
            inventory.status = "sold_out";
        }

        /* ================= PRICING ================= */

        const RETAIL_MARGIN_PERCENT = 4;
        const RETAIL_MARGIN = RETAIL_MARGIN_PERCENT / 100;

        const totalCost =
            inventory.dispatchCost +
            inventory.transportCharge;

        const costPerKg = totalCost / inventory.quantity;

        const sellingPrice = inventory.retailerPerKgPrice;

        const totalSaleValue = mul(sellingPrice, qty);

        const profitPerKg = sellingPrice - costPerKg;

        const profitEarned = mul(profitPerKg, qty);

        const basePerKg = costPerKg;

        const normalizedFinal = money(sellingPrice);

        const normalizedTotal = money(totalSaleValue);

        /* ================= SALE LOG ================= */

        const lastSale = await SaleLog
            .findOne({ inventoryId })
            .sort({ createdAt: -1 });

        const previousHash =
            lastSale?.saleHash || inventory.allocationHash;

        const saleData = {
            inventoryId,
            retailerId: inventory.retailerId,
            batchId: inventory.batchId,
            cropName: inventory.cropName,

            quantitySold: qty,
            remainingAfterSale: inventory.remainingQuantity,

            basePerKgPrice: money(basePerKg),
            retailerMarginPercent: RETAIL_MARGIN_PERCENT,
            finalPerKgPrice: normalizedFinal,

            totalSaleValue: normalizedTotal,
            profitEarned: money(profitEarned),

            previousHash
        };

        const saleHash = generateSaleHash(saleData);

        await SaleLog.create({
            ...saleData,
            saleHash
        });

        const updatedInventory = await inventory.save();

        await updateTrustScore({
            role: "RETAILER",
            roleId: updatedInventory.retailerId,
            entityName: updatedInventory.retailerId,
            isValid: true,
            batchId: updatedInventory.batchId,
            reason: "Retail inventory sale recorded"
        });

        return res.json({
            message: "Sale recorded successfully",
            totalSaleValue: normalizedTotal,
            finalPerKgPrice: normalizedFinal,
            profitEarned: money(profitEarned)
        });

    } catch (err) {
        console.error("Sale recording error:", err.message);
        res.status(500).json({
            error: "Sale failed",
            details: err.message
        });
    }
};

/* =====================================================
   🔹 SALES HISTORY (SAFE PLACEHOLDER)
===================================================== */

const getSalesHistory = async (req, res) => {
    try {
        const retailerId = req.headers["x-retailer-id"];

        const logs = await SaleLog.aggregate([
            {
                $match: { retailerId }
            },
            {
                $lookup: {
                    from: "retailerinventories",
                    localField: "inventoryId",
                    foreignField: "inventoryId",
                    as: "inventory"
                }
            },
            {
                $lookup: {
                    from: "produces",
                    localField: "inventory.batchId",
                    foreignField: "batchId",
                    as: "produce"
                }
            },
            {
                $addFields: {
                    cropName: {
                        $ifNull: [
                            { $arrayElemAt: ["$produce.cropName", 0] },
                            "Unknown"
                        ]
                    }
                }
            },
            {
                $project: {
                    inventory: 0,
                    produce: 0
                }
            },
            {
                $sort: { createdAt: -1 }
            }
        ]);

        res.json(logs);

    } catch (err) {
        res.status(500).json({ error: "Failed to fetch sales history" });
    }
};


/* =====================================================
   🔹 SALES ANALYTICS
===================================================== */

const getSalesAnalytics = async (req, res) => {
    try {
        const retailerId = req.headers["x-retailer-id"];

        const logs = await SaleLog.find({ retailerId });

        const totalSold = logs.reduce(
            (sum, s) => sum + s.quantitySold,
            0
        );

        const roundedTotalSold = Number(totalSold.toFixed(2));

        res.json({
            totalTransactions: logs.length,
            totalSoldQuantity: totalSold
        });

    } catch (err) {
        res.status(500).json({ error: "Failed to fetch analytics" });
    }
};

const getRecentSales = async (req, res) => {
    try {
        const { retailerId } = req.params;

        const recentSales = await SaleLog.aggregate([
            {
                $match: { retailerId }
            },
            {
                $lookup: {
                    from: "retailerinventories",
                    localField: "inventoryId",
                    foreignField: "inventoryId",
                    as: "inventory"
                }
            },
            {
                $lookup: {
                    from: "produces",
                    localField: "inventory.batchId",
                    foreignField: "batchId",
                    as: "produce"
                }
            },
            {
                $addFields: {
                    cropName: {
                        $ifNull: [
                            "$cropName", // ✅ first try stored value
                            { $arrayElemAt: ["$produce.cropName", 0] },
                            "Unknown Crop"
                        ]
                    }
                }
            },
            {
                $project: {
                    inventory: 0,
                    produce: 0
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $limit: 5
            }
        ]);

        res.json(recentSales);

    } catch (err) {
        console.error("Recent sales error:", err.message);
        res.status(500).json({
            error: "Failed to fetch recent sales"
        });
    }
};


module.exports = {
    getRetailerInventory,
    recordSale,
    getSalesHistory,
    getSalesAnalytics,
    getRecentSales
};