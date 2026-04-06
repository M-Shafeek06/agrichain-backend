const Shipment = require("../models/Shipment");
const RoleIdentity = require("../models/RoleIdentity");
const RetailerInventory = require("../models/RetailerInventory");
const { verifyAndUpdateInventoryIntegrity } = require("../services/saleIntegrityService");
const { money, mul, add, sub } = require("../utils/money");
const { generateSaleHash } = require("../services/saleIntegrityService");
const SaleLog = require("../models/SaleLog");

exports.getRetailers = async (req, res) => {
    try {
        const retailers = await RoleIdentity.find({ role: "RETAILER" })
            .select("roleId name location")
            .lean();

        res.json(Array.isArray(retailers) ? retailers : []);

    } catch (err) {
        console.error("❌ RETAILER LIST ERROR:", err);
        res.status(500).json({ message: "Retailer fetch failed" });
    }
};


exports.getRetailerStats = async (req, res) => {
    try {
        const retailerId = req.params.id;

        if (!retailerId) {
            return res.status(400).json({ message: "Retailer ID required" });
        }

        const latestShipments = await Shipment.aggregate([
            {
                $match: {
                    retailerId,
                    status: "DELIVERED"
                }
            },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: "$batchId",
                    latest: { $first: "$$ROOT" }
                }
            },
            { $replaceRoot: { newRoot: "$latest" } }
        ]);

        const totalReceived = latestShipments.length;

        const verified = latestShipments.filter(
            s => s.isValid === true
        ).length;

        const tampered = latestShipments.filter(
            s => s.isValid === false || s.status === "TAMPERED"
        ).length;

        const storesCovered = new Set(
            latestShipments
                .map(s => s.location)
                .filter(Boolean)
        ).size;

        const dailyActivity = await Shipment.aggregate([
            {
                $match: {
                    retailerId,
                    status: "DELIVERED"
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: "$createdAt"
                        }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: -1 } },
            { $limit: 7 },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            totalReceived,
            verified,
            tampered,
            storesCovered,
            dailyActivity,
            latestShipments
        });

    } catch (err) {
        console.error("❌ RETAILER STATS ERROR:", err);
        res.status(500).json({ message: "Retailer stats fetch failed" });
    }
};


exports.getRetailerHistory = async (req, res) => {
    try {
        const retailerId = req.params.id;

        if (!retailerId) {
            return res.status(400).json({ message: "Retailer ID required" });
        }

        const history = await Shipment.aggregate([
            {
                $match: {
                    retailerId,
                    status: "DELIVERED"
                }
            },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: "$batchId",
                    latest: { $first: "$$ROOT" }
                }
            },
            { $replaceRoot: { newRoot: "$latest" } }
        ]);

        res.json(history);

    } catch (err) {
        console.error("❌ RETAILER HISTORY ERROR:", err);
        res.status(500).json({ message: "Retailer history fetch failed" });
    }
};

const RetailerProfile = require("../models/RetailerProfile");

exports.getRetailerSupportInfo = async (req, res) => {
    try {

        const retailers = await RoleIdentity.find({ role: "RETAILER" })
            .select("roleId name location")
            .lean();

        const profiles = await RetailerProfile.find()
            .select("roleId emergencyContact")
            .lean();

        const profileMap = {};
        profiles.forEach(p => {
            profileMap[p.roleId] = p.emergencyContact;
        });

        const result = retailers.map(r => ({
            name: r.name,
            location: r.location,
            phone: profileMap[r.roleId] || null
        }));

        res.json(result);

    } catch (err) {
        console.error("Retailer support fetch error:", err);
        res.status(500).json({ message: "Failed to fetch retailers" });
    }
};

exports.sellProduce = async (req, res) => {
    try {

        const { inventoryId } = req.params;
        const quantity = Number(req.body.quantity);
        const retailerId =
            req.headers["x-retailer-id"] ||
            req.headers["x-role-id"];

        if (!inventoryId || !quantity || quantity <= 0) {
            return res.status(400).json({
                message: "Invalid inventory or quantity"
            });
        }

        /* ================= ATOMIC UPDATE ================= */

        const inventory = await RetailerInventory.findOne({
            inventoryId,
            retailerId,
            remainingQuantity: { $gte: quantity },
            integrityStatus: { $ne: "TAMPERED" }
        });

        if (!inventory) {
            return res.status(400).json({
                message: "Not enough stock available"
            });
        }

        // 🔹 ROUND FUNCTION
        const round = (num) => Math.round(num * 100) / 100;

        // 🔹 SAFE CALCULATION
        inventory.soldQuantity = round(inventory.soldQuantity + quantity);
        inventory.remainingQuantity = round(
            inventory.quantity - inventory.soldQuantity
        );

        const updatedInventory = await inventory.save();

        /* ================= STATUS UPDATE ================= */

        if (updatedInventory.remainingQuantity <= 0) {
            updatedInventory.status = "sold_out";
            await updatedInventory.save();
        }

        /* ================= PRICING ================= */

        const RETAIL_MARGIN = 0.04;

        const costPerKg = updatedInventory.retailerPerKgPrice;

        const finalPerKgPrice = mul(costPerKg, (1 + RETAIL_MARGIN));

        const totalSaleValue = mul(finalPerKgPrice, quantity);

        const profitEarned = mul(
            sub(finalPerKgPrice, costPerKg),
            quantity
        );

        /* ================= SALE LOG ================= */

        const lastSale = await SaleLog
            .findOne({ inventoryId })
            .sort({ createdAt: -1 });

        const previousHash =
            lastSale?.saleHash || updatedInventory.allocationHash;

        const saleData = {
            inventoryId,
            retailerId,
            batchId: updatedInventory.batchId,
            cropName: updatedInventory.cropName,
            quantitySold: quantity,
            remainingAfterSale: updatedInventory.remainingQuantity,
            basePerKgPrice: costPerKg,
            retailerMarginPercent: 4,
            finalPerKgPrice,
            totalSaleValue,
            profitEarned,
            previousHash
        };

        const saleHash = generateSaleHash(saleData);

        await SaleLog.create({
            ...saleData,
            saleHash
        });

        /* ================= RESPONSE ================= */

        return res.json({
            message: "Sale recorded successfully",
            inventoryId,
            soldQuantity: updatedInventory.soldQuantity,
            remainingQuantity: updatedInventory.remainingQuantity,
            finalPerKgPrice,
            totalSaleValue,
            profitEarned
        });

    } catch (err) {
        console.error("❌ SELL PRODUCE ERROR:", err);

        res.status(500).json({
            message: "Retail sale failed"
        });
    }
};

exports.getRetailerInventory = async (req, res) => {
    try {

        const retailerId = req.headers["x-retailer-id"];

        console.log("Retailer ID:", retailerId);

        if (!retailerId) {
            return res.status(400).json({ message: "Retailer ID missing" });
        }

        // 🔥 Step 1: Get all inventories
        const inventories = await RetailerInventory.find({ retailerId });

        console.log("DB COUNT:", inventories.length);

        // 🔥 Step 2: Run integrity verification (blockchain check)
        await Promise.all(
            inventories.map(inv =>
                verifyAndUpdateInventoryIntegrity(inv.inventoryId)
            )
        );

        // 🔥 Step 3: Fetch UPDATED data (important)
        const updatedInventories = await RetailerInventory.find({ retailerId });

        // ✅ Step 4: Send ONLY ONCE
        return res.json(updatedInventories);

    } catch (err) {
        console.error("Inventory fetch failed:", err);
        res.status(500).json({ message: "Failed to fetch inventory" });
    }
};