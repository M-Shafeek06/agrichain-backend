const RetailerInventory = require("../models/RetailerInventory");
const Shipment = require("../models/Shipment");
const Produce = require("../models/Produce");
const SaleLog = require("../models/SaleLog");

/* ================= GET RETAILER ADVANCED STATS ================= */

exports.getRetailerAdvancedStats = async (req, res) => {
    try {
        const retailerId = req.params.id;

        if (!retailerId) {
            return res.status(400).json({
                message: "Retailer ID required"
            });
        }

        /* =======================================================
    1️⃣ INVENTORY BASED METRICS
 ======================================================= */

        const inventory = await RetailerInventory.find({
            retailerId
        }).lean();

        const totalReceived = inventory.length;

        let soldBatches = 0;
        let partiallySold = 0;
        let available = 0;
        let totalAvailableQuantity = 0;


        /* ✅ LOOP ONLY FOR INVENTORY CALCULATION */
        for (const item of inventory) {
            const soldQty = item.soldQuantity || 0;
            const remainingQty = item.remainingQuantity || 0;
            const status = item.status;
            const integrity = item.integrityStatus;

            if (integrity === "AUTHENTIC") {
                totalAvailableQuantity += remainingQty;

                if (remainingQty === 0 && status === "sold_out") {
                    soldBatches++;
                } else if (soldQty > 0 && remainingQty > 0) {
                    partiallySold++;
                } else if (remainingQty > 0) {
                    available++;
                }
            }
        }

        /* =======================================================
           2️⃣ INVENTORY BASED VERIFICATION (OUTSIDE LOOP)
        ======================================================= */

        let verified = 0;
        let tampered = 0;

        let tamperedQuantity = 0;   // ✅ NEW

        for (const item of inventory) {
            const remainingQty = item.remainingQuantity || 0;
            const soldQty = item.soldQuantity || 0;

            if (item.integrityStatus === "AUTHENTIC") {
                verified++;
            }
            else if (item.integrityStatus === "TAMPERED") {
                tampered++;

                tamperedQuantity += remainingQty;
            }
        }

        /* =======================================================
   3️⃣ DAILY SALES TREND + TODAY SALES
======================================================= */

// IST SAFE DATE RANGE
const now = new Date();

const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
);

const endOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23, 59, 59, 999
);

// LAST 7 DAYS
const last7Days = new Date();
last7Days.setDate(last7Days.getDate() - 7);

/* =======================================================
   SALES ANALYTICS FROM SALE LOGS
======================================================= */

// DAILY SALES TREND
const dailySalesAgg = await SaleLog.aggregate([
    {
        $match: {
            retailerId,
            createdAt: { $gte: last7Days }
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
            totalSold: {
                $sum: "$quantitySold"
            }
        }
    },
    { $sort: { _id: 1 } }
]);

const dailySales = dailySalesAgg.map(d => ({
    date: d._id,
    count: Number(d.totalSold.toFixed(2))
}));

/* =======================================================
   TODAY SOLD
======================================================= */

const todaySalesAgg = await SaleLog.aggregate([
    {
        $match: {
            retailerId,
            createdAt: {
                $gte: startOfDay,
                $lte: endOfDay
            }
        }
    },
    {
        $group: {
            _id: null,
            todaySold: {
                $sum: "$quantitySold"
            }
        }
    }
]);

const todaySold =
    todaySalesAgg.length > 0
        ? Number(todaySalesAgg[0].todaySold.toFixed(2))
        : 0;

/* =======================================================
   TOTAL SOLD
======================================================= */

const totalSalesAgg = await SaleLog.aggregate([
    {
        $match: { retailerId }
    },
    {
        $group: {
            _id: null,
            totalSold: {
                $sum: "$quantitySold"
            }
        }
    }
]);

const totalSoldQuantity =
    totalSalesAgg.length > 0
        ? Number(totalSalesAgg[0].totalSold.toFixed(2))
        : 0;

        /* =======================================================
           4️⃣ TRUST SCORE
        ======================================================= */

        const TrustScore = require("../models/TrustScore");

        const trustDoc = await TrustScore.findOne({ roleId: retailerId });

        let trustScore = 0;

        if (trustDoc) {
            trustScore = trustDoc.trustScore;
        }
        /* =======================================================
           FINAL RESPONSE
        ======================================================= */

        res.json({
            totalReceived,
            verified,
            tampered,
            tamperedQuantity,
            sold: totalSoldQuantity,
            todaySold,
            onStock: totalAvailableQuantity,
            dailySales,
            trustScore,
            soldBatches,
            partiallySold,
            available,
            totalSoldQuantity,
            totalAvailableQuantity
        });
    } catch (err) {
        console.log("Retailer advanced analytics error:", err);
        res.status(500).json({
            message: "Retailer analytics fetch failed"
        });
    }
};
