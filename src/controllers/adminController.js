const Produce = require("../models/Produce");
const Shipment = require("../models/Shipment");
const updateTrustScore = require("../utils/updateTrustScore");
const TrustScore = require("../models/TrustScore");
const RetailerProfile = require("../models/RetailerProfile");

const {
    storeAdminVerificationOnBlockchain
} = require("../services/blockchainService");

/* =========================================================
   📊 ADMIN ANALYTICS (READ-ONLY)
========================================================= */
async function getAdminAnalytics(req, res) {
    try {
        const produces = await Produce.find(
            {},
            "batchId farmerName integrityStatus integrityScore verificationStatus createdAt updatedAt"
        ).lean();

        let totalBatches = produces.length;
        let verifiedBatches = 0;
        let tamperedBatches = 0;
        let rejectedBatches = 0;
        let pendingBatches = 0;
        let integritySum = 0;
        let integrityCount = 0;

        const integrityTrend = [];

        for (const p of produces) {

            const integrity = (p.integrityStatus || "").toUpperCase();
            const status = (p.verificationStatus || "").toUpperCase();

            /* ===== COUNTS ===== */

            if (integrity === "TAMPERED") {
                tamperedBatches++;
            }

            if (status === "REJECTED") {
                rejectedBatches++;
            }

            if (status === "PENDING" && integrity !== "TAMPERED") {
                pendingBatches++;
            }

            if (integrity === "AUTHENTIC" && status === "APPROVED") {
                verifiedBatches++;
            }

            /* ===== AVG INTEGRITY ===== */

            if (integrity === "AUTHENTIC" && typeof p.integrityScore === "number") {
                integritySum += p.integrityScore;
                integrityCount++;
            }

            /* ===== TREND ===== */

            integrityTrend.push({
                date: p.updatedAt || p.createdAt,
                integrityScore: integrity === "AUTHENTIC" ? p.integrityScore : 0
            });
        }

        const averageIntegrityScore =
            integrityCount > 0
                ? Math.round(integritySum / integrityCount)
                : 0;

        /* ================= RECENT ACTIVITY ================= */

        let recentActivities = await Shipment.find()
            .sort({ createdAt: -1 })
            .limit(4) // ✅ only latest 4 (your requirement)
            .select("batchId handlerName status createdAt")
            .lean();

        if (recentActivities.length === 0) {
            recentActivities = produces
                .sort((a, b) =>
                    new Date(b.updatedAt || b.createdAt) -
                    new Date(a.updatedAt || a.createdAt)
                )
                .slice(0, 4)
                .map(p => ({
                    batchId: p.batchId,
                    handlerName: p.farmerName || "System",
                    status: p.verificationStatus || "PENDING",
                    createdAt: p.updatedAt || p.createdAt
                }));
        }

        /* ================= MONTHLY STATS ================= */

        const monthlyStats = await Produce.aggregate([
            {
                $group: {
                    _id: {
                        month: { $month: "$createdAt" },
                        year: { $year: "$createdAt" }
                    },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id.year": -1, "_id.month": -1 } },
            { $limit: 6 },
            {
                $project: {
                    _id: 0,
                    month: {
                        $arrayElemAt: [
                            ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
                            { $subtract: ["$_id.month", 1] }
                        ]
                    },
                    count: 1
                }
            }
        ]);

        /* ================= ROLE DISTRIBUTION ================= */

        const roleDistribution = await RoleIdentity.aggregate([
            {
                $group: {
                    _id: "$role",
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    role: "$_id",
                    count: 1
                }
            }
        ]);

        return res.status(200).json({
            totalBatches,
            verifiedBatches,
            tamperedBatches,
            rejectedBatches,
            pendingBatches,
            averageIntegrityScore,
            integrityTrend,
            recentActivities,
            monthlyStats,
            roleDistribution
        });

    } catch (error) {
        console.error("ADMIN DASHBOARD ERROR:", error.message);
        return res.status(500).json({
            message: "Dashboard analytics failed",
            error: error.message
        });
    }
}


/* =========================================================
   🏆 TRUST LEADERBOARD
========================================================= */
const RoleIdentity = require("../models/RoleIdentity");

async function getTrustLeaderboard(req, res) {
    try {
        const trustData = await TrustScore.find({})
            .sort({ trustScore: -1 })
            .limit(10)
            .lean();

        const enrichedData = await Promise.all(
            trustData.map(async (item) => {
                const identity = await RoleIdentity.findOne({
                    roleId: item.roleId
                }).lean();

                return {
                    ...item,
                    entityName: identity ? identity.name : item.roleId
                };
            })
        );

        return res.status(200).json(enrichedData);

    } catch (err) {
        console.error("TRUST LEADERBOARD ERROR:", err);
        return res.status(500).json({
            message: "Trust leaderboard fetch failed"
        });
    }
}

/* =========================================================
   👥 ADMIN - FETCH ALL SYSTEM USERS
========================================================= */
async function getAllUsers(req, res) {
    try {

        /* ---------- BASE USERS ---------- */

        const users = await RoleIdentity.find(
            { role: { $ne: "ADMIN" } },
            {
                name: 1,
                role: 1,
                roleId: 1,
                location: 1,
                organization: 1,
                emergencyContact: 1
            }
        )
            .sort({ role: 1 })
            .lean();

        /* ---------- FETCH TRUST SCORES ---------- */

        const trustData = await TrustScore.find({}).lean();

        const trustMap = {};
        trustData.forEach(t => {
            trustMap[t.roleId] = t.trustScore;
        });

        /* ---------- FETCH RETAILER PROFILES ---------- */

        const retailerProfiles = await RetailerProfile.find().lean();

        const retailerMap = {};
        retailerProfiles.forEach(r => {
            retailerMap[r.roleId] = r;
        });

        /* ---------- MERGE ALL ---------- */

        const mergedUsers = users.map(u => {

            let contact = u.emergencyContact || "";

            if (!contact && retailerMap[u.roleId]) {
                contact = retailerMap[u.roleId].emergencyContact || "";
            }

            return {
                ...u,
                emergencyContact: contact,

                // ✅ ADD TRUST SCORE HERE
                trustScore: trustMap[u.roleId] ?? 50
            };
        });

        return res.status(200).json(mergedUsers);

    } catch (err) {
        console.error("GET ALL USERS ERROR:", err);
        return res.status(500).json({
            message: "Failed to fetch users"
        });
    }
}

/* =========================================================
   ❌ ADMIN CONFIRM TAMPER (FINAL STABLE VERSION)
========================================================= */
async function confirmTamper(req, res) {
    try {
        const batchId = (req.params?.batchId || "").trim();
        const adminRemark = (req.body?.adminRemark || "Batch rejected due to tampering").trim();

        if (!batchId) {
            return res.status(400).json({ message: "Batch ID required" });
        }

        const produce = await Produce.findOne({ batchId });

        if (!produce) {
            return res.status(404).json({ message: "Invalid Batch ID" });
        }

        if (produce.verificationStatus === "REJECTED") {
            return res.json({
                message: "Batch already rejected",
                batchId
            });
        }

        const now = new Date();

        /* ================= STATE + VERIFICATION ================= */

        produce.integrityStatus = "AUTHENTIC";   // ✅ NOT tampered
        produce.integrityScore = 100;            // ✅ still valid data
        produce.verificationStatus = "REJECTED"; // ✅ business decision

        produce.state = "CREATED_BY_FARMER"; // optional fallback

        produce.verifiedBy = "ADMIN";
        produce.verifiedAt = now;
        produce.adminRemark = adminRemark;
        produce.updatedAt = now;

        await produce.save();

        /* ================= TRUST SCORE PENALTY ================= */

        await updateTrustScore({
            role: "FARMER",
            roleId: produce.farmerId,
            entityName: produce.farmerName,
            isValid: false,
            batchId: produce.batchId,
            reason: "Batch rejected by admin (quality/policy issue)"
        });

        return res.status(200).json({
            message: "Batch rejected successfully",
            batchId,
            verificationStatus: "REJECTED"
        });

    } catch (err) {
        console.error("ADMIN CONFIRM ERROR:", err);
        return res.status(500).json({
            message: "Tamper confirmation failed"
        });
    }
}

/* =========================================================
   ✅ ADMIN APPROVE PRODUCE (FINAL STABLE VERSION + BASE PRICE)
========================================================= */
async function approveProduce(req, res) {
    try {
        const batchId = (req.params?.batchId || "").trim();
        const adminRemark = (req.body?.adminRemark || "Batch approved").trim();
        const basePrice = Number(req.body?.basePrice);

        if (!batchId) {
            return res.status(400).json({ message: "Batch ID required" });
        }

        if (!basePrice || basePrice <= 0 || basePrice > 250) {
            return res.status(400).json({
                message: "Base price must be between ₹1 and ₹250 per kg"
            });
        }
        const produce = await Produce.findOne({ batchId });

        if (!produce) {
            return res.status(404).json({ message: "Invalid Batch ID" });
        }

        if (produce.integrityStatus === "TAMPERED") {
            return res.status(400).json({
                message: "Cannot approve a tampered batch"
            });
        }

        if (produce.verificationStatus === "APPROVED") {
            return res.json({
                message: "Batch already approved",
                batchId,
                verificationStatus: "APPROVED",
                basePrice: produce.basePrice || null
            });
        }

        const now = new Date();

        /* ================= STATE + VERIFICATION ================= */

        produce.verificationStatus = "APPROVED";
        produce.integrityStatus = "AUTHENTIC";
        produce.integrityScore = 100;
        produce.state = "VERIFIED_BY_ADMIN";
        produce.verifiedBy = "ADMIN";
        produce.verifiedAt = now;
        produce.adminRemark = adminRemark;
        produce.updatedAt = now;

        /* ================= BASE PRICE ASSIGNMENT ================= */
        // Base price assigned only during approval
        produce.basePrice = basePrice;
        produce.priceAssignedBy = "ADMIN";
        produce.priceAssignedAt = now;

        await produce.save();

        /* ================= BLOCKCHAIN ANCHOR ================= */

        await storeAdminVerificationOnBlockchain(
            produce.batchId,
            "ADMIN",
            adminRemark
        );

        /* ================= TRUST SCORE UPDATE ================= */

        await updateTrustScore({
            role: "FARMER",
            roleId: produce.farmerId,
            entityName: produce.farmerName,
            isValid: true,
            batchId: produce.batchId,
            reason: "Batch approved by admin with base price assigned"
        });

        return res.status(200).json({
            message: "Batch approved successfully",
            batchId,
            verificationStatus: "APPROVED",
            basePrice
        });

    } catch (err) {
        console.error("ADMIN APPROVE ERROR:", err);
        return res.status(500).json({
            message: "Approval failed"
        });
    }
}


/* =========================================================
   🚚 ADMIN CONFIRM TRANSPORTER COLLECTION
========================================================= */
async function confirmTransporterCollection(req, res) {
    try {
        const batchId =
            (req.params?.batchId || req.body?.batchId || "").trim();

        if (!batchId) {
            return res.status(400).json({
                message: "Batch ID required"
            });
        }

        const produce = await Produce.findOne({ batchId });

        if (!produce) {
            return res.status(404).json({
                message: "Invalid Batch ID"
            });
        }

        if (produce.verificationStatus !== "APPROVED") {
            return res.status(400).json({
                message:
                    "Produce must be approved before transporter collection",
                verificationStatus: produce.verificationStatus
            });
        }

        if (produce.transporterCollected === true) {
            return res.status(200).json({
                message: "Transporter collection already confirmed",
                batchId,
                transporterCollected: true
            });
        }

        const now = new Date();

        produce.transporterCollected = true;
        produce.transporterCollectedAt = now;
        produce.updatedAt = now;

        await produce.save();

        return res.status(200).json({
            message: "Transporter collection confirmed successfully",
            batchId,
            transporterCollected: true
        });

    } catch (err) {
        console.error("CONFIRM TRANSPORTER COLLECTION ERROR:", err);
        return res.status(500).json({
            message: "Transporter collection confirmation failed"
        });
    }
}


/* =========================================================
   🧪 ATTACK SIMULATION (DEMO ONLY)
========================================================= */
async function simulateAttack(req, res) {
    try {
        const batchId = (req.body?.batchId || "").trim();

        if (!batchId) {
            return res.status(400).json({
                message: "Batch ID is required"
            });
        }

        const produce = await Produce.findOne({ batchId });

        if (!produce) {
            return res.status(404).json({
                message: "Invalid Batch ID"
            });
        }

        if (!produce.originalSnapshot?.quantity) {
            return res.status(400).json({
                message:
                    "Original snapshot missing — cannot simulate attack"
            });
        }

        const beforeQuantity =
            produce.originalSnapshot.quantity;

        const now = new Date();

        produce.originalSnapshot.quantity =
            Number(beforeQuantity) + 5;
        produce.integrityStatus = "TAMPERED";
        produce.integrityScore = 0;
        produce.verificationStatus = "REJECTED";
        produce.verifiedBy = "SYSTEM";
        produce.adminRemark = "Integrity violation detected by system";
        produce.verifiedAt = now;
        produce.updatedAt = now;

        await produce.save();

        return res.status(200).json({
            message: "Attack simulation successful",
            tamperedField: "quantity",
            beforeValue: beforeQuantity,
            afterValue:
                produce.originalSnapshot.quantity,
            integrityStatus: "TAMPERED"
        });

    } catch (err) {
        console.error("ATTACK SIMULATION ERROR:", err);
        return res.status(500).json({
            message: "Attack simulation failed"
        });
    }
}


/* =========================================================
   📜 ADMIN - FULL SYSTEM ACTIVITY TIMELINE
========================================================= */
const SaleLog = require("../models/SaleLog");

async function getActivityTimeline(req, res) {
    try {

        /* ================= FETCH ALL ================= */

        const [produces, shipments, sales, users, retailerProfiles] = await Promise.all([

            Produce.find({}, {
                batchId: 1,
                farmerId: 1,
                farmerName: 1,
                createdAt: 1
            }).lean(),

            Shipment.find({}, {
                batchId: 1,
                handlerId: 1,
                status: 1,
                location: 1,
                createdAt: 1
            }).lean(),

            SaleLog.find({}, {
                batchId: 1,
                retailerId: 1,
                quantitySold: 1,
                createdAt: 1
            }).lean(),

            // 🔥 FETCH ALL USERS ONCE
            RoleIdentity.find({}, {
                roleId: 1,
                name: 1,
                role: 1,
                emergencyContact: 1,
                location: 1
            }).lean(),

            RetailerProfile.find({}).lean()
        ]);

        /* ================= CREATE MAPS ================= */

        const userMap = {};
        users.forEach(u => {
            userMap[u.roleId] = u;
        });

        const retailerMap = {};
        retailerProfiles.forEach(r => {
            retailerMap[r.roleId] = r;
        });

        /* ================= FARMER ================= */

        const farmerActivities = produces.map(p => {

            const user = userMap[p.farmerId];

            return {
                batchId: p.batchId,
                roleId: p.farmerId,
                roleName: "FARMER",

                name: user?.name || p.farmerName || "Farmer",

                contact: user?.emergencyContact || "N/A",

                location: user?.location || "Farm",

                status: "CREATED",
                time: p.createdAt
            };
        });

        /* ================= SHIPMENT ================= */

        const shipmentActivities = shipments.map(s => {

            const user = userMap[s.handlerId];

            return {
                batchId: s.batchId,
                roleId: s.handlerId || "—",

                roleName: user?.role || "System",

                name: user?.name || "Unknown",

                contact: user?.emergencyContact || "N/A",

                location: s.location || user?.location || "—",

                status: s.status,
                time: s.createdAt
            };
        });

        /* ================= RETAILER ================= */

        const retailerActivities = sales.map(sale => {

            const identity = userMap[sale.retailerId];
            const profile = retailerMap[sale.retailerId];

            return {
                batchId: sale.batchId,
                roleId: sale.retailerId,
                roleName: "RETAILER",

                name:
                    identity?.name ||
                    profile?.storeName ||
                    "Retailer",

                contact:
                    profile?.emergencyContact ||
                    identity?.emergencyContact ||
                    "N/A",

                location:
                    identity?.location ||
                    profile?.storeName ||
                    "Store",

                status: `SOLD (${sale.quantitySold} kg)`,

                time: sale.createdAt
            };
        });

        /* ================= MERGE + SORT ================= */

        const timeline = [
            ...farmerActivities,
            ...shipmentActivities,
            ...retailerActivities
        ].sort((a, b) => new Date(b.time) - new Date(a.time));

        return res.status(200).json(timeline);

    } catch (err) {
        console.error("ACTIVITY TIMELINE ERROR:", err);
        return res.status(500).json({
            message: "Failed to fetch activity timeline"
        });
    }
}

/* ================= EXPORTS ================= */
module.exports = {
    getAdminAnalytics,
    confirmTamper,
    approveProduce,
    confirmTransporterCollection,
    simulateAttack,
    getTrustLeaderboard,
    getAllUsers,
    getActivityTimeline
};