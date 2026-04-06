const Shipment = require("../models/Shipment");
const Produce = require("../models/Produce");
const blockchainService = require("../services/blockchainService");
const RetailerRequest = require("../models/RetailerRequest");
const { verifyBatch } = require("./verifyController");
const updateTrustScore = require("../utils/updateTrustScore");

/* =========================================================
   🔐 AUTH HELPER
========================================================= */

function getDistributorId(req, res) {
    const distributorId = req.headers["x-role-id"];

    if (!distributorId) {
        res.status(401).json({
            message: "Unauthorized: Distributor ID missing"
        });
        return null;
    }

    return distributorId;
}

/* =========================================================
   📊 DASHBOARD (STRICT STATE-DRIVEN)
========================================================= */

exports.getDashboard = async (req, res) => {
    try {
        const distributorId = getDistributorId(req, res);
        if (!distributorId) return;

        const produceDocs = await Produce.find({
            distributorId,
            integrityStatus: { $ne: "TAMPERED" },
            state: {
                $in: [
                    "IN_TRANSPORT_TO_DISTRIBUTOR",
                    "OWNED_BY_DISTRIBUTOR",
                    "READY_FOR_DISPATCH",
                    "RETAILER_REQUESTED",
                    "DISPATCHED_TO_RETAILER",
                    "DELIVERED_TO_RETAILER",   // 🔥 IMPORTANT
                    "SOLD",
                    "PARTIALLY_SOLD"
                ]
            }
        }).lean();

        /* ================= STATE COUNTS ================= */

        const totalProfit = produceDocs.reduce((sum, p) => {
            return sum + Number(p.distributorProfit || 0);
        }, 0);

        const incoming = produceDocs.filter(
            p => p.state === "IN_TRANSPORT_TO_DISTRIBUTOR"
        ).length;

        const inventory = produceDocs.filter(
            p => p.state === "OWNED_BY_DISTRIBUTOR"
        ).length;

        const approvedRequests = await RetailerRequest.find({
            distributorId,
            status: "APPROVED"
        }).lean();

        const approvedBatchIds = new Set(
            approvedRequests.map(r => r.batchId)
        );

        const pending = produceDocs.filter(p =>
            approvedBatchIds.has(p.batchId) &&
            p.remainingQuantity > 0
        ).length;

        const dispatched = produceDocs.filter(
            p => p.state === "RETAILER_REQUESTED" ||
                p.state === "DISPATCHED_TO_RETAILER"
        ).length;


        const sold = produceDocs.filter(
            p => p.state === "SOLD" || p.state === "PARTIALLY_SOLD"
        ).length;

        const rejected = await Produce.countDocuments({
            distributorId,
            integrityStatus: "TAMPERED",
            verificationStatus: "INVALIDATED",
            state: {
                $in: [
                    "IN_TRANSPORT_TO_DISTRIBUTOR",
                    "OWNED_BY_DISTRIBUTOR",
                    "RETAILER_REQUESTED",
                    "DISPATCHED_TO_RETAILER"
                ]
            }
        });

        /* ================= INVENTORY MAP ================= */

        const inventoryMap = {};
        const qualityMap = { A: 0, B: 0, C: 0 };

        for (const p of produceDocs) {
            if (p.state !== "OWNED_BY_DISTRIBUTOR") continue;

            const crop = p.cropName || "Unknown";
            const qty = p.remainingQuantity || 0;
            const grade = p.qualityGrade;

            inventoryMap[crop] = (inventoryMap[crop] || 0) + qty;

            if (grade && qualityMap[grade] !== undefined) {
                qualityMap[grade]++;
            }
        }

        /* ================= RECENT ================= */

        const recent = produceDocs
            .filter(p =>
                p.state === "OWNED_BY_DISTRIBUTOR" ||
                p.state === "READY_FOR_DISPATCH" ||
                p.state === "DISPATCHED_TO_RETAILER" ||
                p.state === "SOLD"
            )
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .slice(0, 5)
            .map(p => ({
                _id: p._id,
                batchId: p.batchId,
                crop: p.cropName,
                qty:
                    p.remainingQuantity > 0
                        ? p.remainingQuantity
                        : (p.totalQuantity || p.soldQuantity || 0),
                status: approvedBatchIds.has(p.batchId)
                    ? "READY_FOR_DISPATCH"
                    : p.state
            }));

        res.json({
            incoming,
            inventory,
            dispatched,
            pending,
            rejected,
            sold,
            totalProfit,
            inventoryMap,
            qualityMap,
            recent,
            produces: produceDocs
        });

    } catch (err) {
        console.error("Distributor Dashboard Error:", err);

        res.status(500).json({
            incoming: 0,
            inventory: 0,
            dispatched: 0,
            pending: 0,
            inventoryMap: {},
            qualityMap: { A: 0, B: 0, C: 0 },
            recent: []
        });
    }
};

/* =========================================================
   📦 INCOMING SHIPMENTS (AUTO VERIFIED - FINAL FIX)
========================================================= */

exports.getIncomingShipments = async (req, res) => {
    try {
        const distributorId = getDistributorId(req, res);
        if (!distributorId) return;

        /* =====================================================
           1️⃣ GET ALL SHIPMENTS (LATEST FIRST)
        ===================================================== */

        const shipments = await Shipment.find({
            distributorId
        }).sort({ _id: -1 }).lean(); // 🔥 stable ordering

        // 👉 Get latest per batch
        const latestShipmentMap = {};

        for (const s of shipments) {
            if (!latestShipmentMap[s.batchId]) {
                latestShipmentMap[s.batchId] = s;
            }
        }

        const latestShipments = Object.values(latestShipmentMap);

        /* =====================================================
           2️⃣ VERIFY EACH BATCH (STRONG CHECK)
        ===================================================== */

        await Promise.all(
            latestShipments.map(async (ship) => {
                try {
                    const produce = await Produce.findOne({
                        batchId: ship.batchId,
                        distributorId: distributorId
                    });

                    if (!produce) return;

                    const fullChain = await Shipment.find({ batchId: ship.batchId })
                        .sort({ _id: 1 })
                        .lean();

                    const sessions = {};

                    // 🔥 group by shipmentSessionId
                    for (const block of fullChain) {
                        if (!sessions[block.shipmentSessionId]) {
                            sessions[block.shipmentSessionId] = [];
                        }
                        sessions[block.shipmentSessionId].push(block);
                    }

                    // 🔥 validate EACH session independently
                    let isTampered = false;

                    for (const sessionId in sessions) {
                        const chain = sessions[sessionId];

                        for (let i = 1; i < chain.length; i++) {
                            const prev = chain[i - 1];
                            const curr = chain[i];

                            // ✅ Only check inside same session AND same stage
                            if (
                                prev.shipmentQuantity !== curr.shipmentQuantity &&
                                prev.retailerId === curr.retailerId
                            ) {
                                isTampered = true;
                            }
                        }
                    }
                    if (isTampered && produce.integrityStatus !== "TAMPERED") {

                        await Produce.updateOne(
                            {
                                batchId: ship.batchId,
                                distributorId: distributorId
                            },
                            {
                                $set: {
                                    integrityStatus: "TAMPERED",
                                    integrityScore: 0,
                                    verificationStatus: "INVALIDATED",
                                    tamperExplanation:
                                        "Quantity mismatch detected in shipment chain"
                                }
                            }
                        );

                        /* 🔥 TRUST PENALTY (CRITICAL FIX) */
                        const produceDoc = await Produce.findOne({ batchId: ship.batchId });

                        const responsibleRole = produceDoc.currentOwnerRole;
                        const responsibleId = produceDoc.currentOwnerId;

                        await updateTrustScore({
                            role: responsibleRole,
                            roleId: responsibleId,
                            entityName: responsibleRole,
                            isValid: false,
                            batchId: ship.batchId,
                            reason: "Shipment quantity tampering detected"
                        });
                    }
                } catch (err) {
                    console.warn("Verification failed:", ship.batchId, err);
                }
            })
        );
        /* =====================================================
           3️⃣ FETCH UPDATED PRODUCE
        ===================================================== */

        const produceList = await Produce.find({
            distributorId,
            state: {
                $in: [
                    "IN_TRANSPORT_TO_DISTRIBUTOR",
                    "OWNED_BY_DISTRIBUTOR"
                ]
            }
        }).lean();

        /* =====================================================
           4️⃣ MAP RESPONSE (FOR UI)
        ===================================================== */

        const result = produceList.map(p => ({
            ...p,
            integrity: p.integrityStatus || "SAFE"
        }));

        return res.json(result);

    } catch (err) {
        console.error("Incoming Shipments Error:", err);
        return res.status(500).json({
            message: "Failed to fetch incoming shipments"
        });
    }
};

/* =========================================================
   🏬 INVENTORY VIEW
========================================================= */

exports.getInventory = async (req, res) => {
    try {
        const distributorId = getDistributorId(req, res);
        if (!distributorId) return;

        const produceDocs = await Produce.find({
            distributorId,
            integrityStatus: { $ne: "TAMPERED" },   // 🔥 KEY FIX
            state: {
                $in: [
                    "OWNED_BY_DISTRIBUTOR",
                    "DELIVERED_TO_RETAILER",
                    "RETAILER_REQUESTED",
                    "DISPATCHED_TO_RETAILER",
                    "SOLD"
                ]
            }
        }).lean();

        const inventory = produceDocs.map(p => {

            const totalQty = Number(p.totalQuantity || 0);
            const soldQty = Number(p.soldQuantity || 0);
            const remainingQty = Number(p.remainingQuantity ?? (totalQty - soldQty));

            return {
                batchId: p.batchId,
                cropName: p.cropName,
                totalQuantity: totalQty,
                soldQuantity: soldQty,              // ✅ FIXED
                remainingQuantity: remainingQty,    // ✅ SAFE
                qualityGrade: p.qualityGrade || "-",
                state: p.state
            };
        });

        res.json(inventory);

    } catch (err) {
        console.error("Inventory Error:", err);
        res.status(500).json({
            message: "Inventory fetch failed"
        });
    }
};


/* =========================================================
   ✅ ACCEPT SHIPMENT
   (TRANSPORT → OWNED_BY_DISTRIBUTOR)
========================================================= */

exports.acceptShipment = async (req, res) => {
    try {
        const distributorId = getDistributorId(req, res);
        if (!distributorId) return;

        const shipment = await Shipment.findOne({
            batchId: req.body.batchId
        });
        if (!shipment)
            return res.status(404).json({ message: "Shipment not found" });

        const produce = await Produce.findOne({
            batchId: shipment.batchId,
            distributorId
        });

        if (!produce)
            return res.status(404).json({ message: "Produce not found" });

        // 🔒 BLOCK REJECTED / INVALIDATED BATCH
        if (produce.verificationStatus !== "APPROVED") {
            return res.status(400).json({
                message: "Rejected or unapproved batch cannot be accepted"
            });
        }

        if (produce.integrityStatus === "TAMPERED") {
            return res.status(400).json({
                message: "Tampered shipment cannot be accepted"
            });
        }

        if (produce.state !== "IN_TRANSPORT_TO_DISTRIBUTOR") {
            return res.status(400).json({
                message: "Shipment not ready for acceptance"
            });
        }

        if (!produce.basePrice || produce.basePrice <= 0) {
            return res.status(400).json({
                message: "Base price missing"
            });
        }

        /* ================= BLOCKCHAIN TRANSFER ================= */

        await blockchainService.storeOwnershipTransferOnBlockchain(
            produce.batchId,
            produce.farmerId,
            distributorId
        );

        /* ================= STATE TRANSITION ================= */

        produce.state = "OWNED_BY_DISTRIBUTOR";
        produce.currentOwnerRole = "DISTRIBUTOR";
        produce.currentOwnerId = distributorId;
        produce.distributorAcceptedAt = new Date();

        await produce.save();

        await updateTrustScore({
            roleId: distributorId,
            isValid: true,
            batchId: produce.batchId,
            reason: "Valid shipment accepted"
        });

        res.json({ message: "Shipment accepted successfully" });

    } catch (err) {
        console.error("Accept Shipment Error:", err);
        res.status(500).json({ message: "Shipment acceptance failed" });
    }
};


/* =========================================================
   💰 CONFIRM BASE PRICE
========================================================= */

exports.confirmBasePrice = async (req, res) => {
    try {
        const distributorId = getDistributorId(req, res);
        if (!distributorId) return;

        const { batchId, acceptedBasePrice } = req.body;

        const produce = await Produce.findOne({
            batchId,
            distributorId
        });

        // 🔒 BLOCK INVALID BATCH
        if (produce.verificationStatus !== "APPROVED") {
            return res.status(400).json({
                message: "Cannot confirm price for rejected batch"
            });
        }

        // 🔒 BLOCK TAMPERED BATCH (NEW FIX)
        if (produce.integrityStatus === "TAMPERED") {
            return res.status(400).json({
                message: "Cannot confirm price for tampered batch"
            });
        }

        if (!produce)
            return res.status(404).json({ message: "Batch not found" });

        if (produce.basePrice !== acceptedBasePrice) {
            return res.status(400).json({
                message: "Must accept admin assigned base price"
            });
        }

        produce.distributorAcceptedBasePrice = acceptedBasePrice;
        produce.distributorAcceptedAt = new Date();

        await produce.save();

        res.json({ message: "Base price confirmed by distributor" });

    } catch (err) {
        console.error("Confirm Base Price Error:", err);
        res.status(500).json({ message: "Confirmation failed" });
    }
};


/* =========================================================
   🚚 DISPATCH LIST (APPROVED REQUESTS WITH CORRECT COST)
========================================================= */

exports.getDispatchList = async (req, res) => {
    try {
        const distributorId = getDistributorId(req, res);
        if (!distributorId) return;

        const requests = await RetailerRequest.find({
            distributorId,
            status: "APPROVED"
        }).lean();

        const produceDocs = await Produce.find({
            distributorId
        }).lean();

        const produceMap = {};
        produceDocs.forEach(p => {
            produceMap[p.batchId] = p;
        });

        const result = requests.map(reqItem => {
            const produce = produceMap[reqItem.batchId];

            if (!produce) return null;

            const totalQty = produce.totalQuantity || 0;
            const totalCost = produce.distributorTotalCost || 0;

            let requestedCost = 0;

            if (totalQty > 0) {
                const unitCost = totalCost / totalQty;
                requestedCost = unitCost * reqItem.requestedQty;
            }

            return {
                _id: reqItem._id, // IMPORTANT: must match what frontend uses
                batchId: reqItem.batchId,
                cropName: reqItem.cropName,
                requestedQty: reqItem.requestedQty,
                status: reqItem.status,
                basePrice: produce.basePrice,
                distributorAcceptedBasePrice: produce.distributorAcceptedBasePrice,
                totalQuantity: produce.totalQuantity,
                distributorTotalCost: produce.distributorTotalCost,
                requestedCost: requestedCost.toFixed(2)
            };
        }).filter(Boolean);

        res.json(result);

    } catch (err) {
        console.error("Dispatch List Error:", err);
        res.status(500).json({ message: "Failed to fetch dispatch list" });
    }
};

exports.getWarehouseHistory = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];

        if (!distributorId) {
            return res.status(401).json({
                message: "Unauthorized: Distributor ID missing"
            });
        }

        const produceDocs = await Produce.find({
            distributorId,
            distributorAcceptedAt: { $ne: null }
        }).lean();

        const history = [];

        let totalReceived = 0;
        let totalSold = 0;

        produceDocs.forEach(p => {

            const totalQty = Number(p.totalQuantity || p.quantity || 0);
            const soldQty = Number(p.soldQuantity || 0);

            /* =====================================================
               ✅ RECEIVED EVENT
            ===================================================== */
            if (p.distributorAcceptedAt) {

                totalReceived += totalQty;

                history.push({
                    batchId: p.batchId,
                    cropName: p.cropName,
                    event: "RECEIVED",
                    tampered: p.integrityStatus === "TAMPERED",
                    quantity: totalQty,
                    time: p.distributorAcceptedAt
                });
            }

            /* =====================================================
               ✅ SOLD EVENT (FIXED ✅)
            ===================================================== */
            if (soldQty > 0) {

                totalSold += soldQty;

                history.push({
                    batchId: p.batchId,
                    cropName: p.cropName,
                    event: "SOLD",
                    quantity: soldQty,
                    time: p.updatedAt // or soldAt if available
                });
            }

            /* =====================================================
               ⚠️ TAMPER EVENT
            ===================================================== */
            if (p.integrityStatus === "TAMPERED") {
                history.push({
                    batchId: p.batchId,
                    cropName: p.cropName,
                    event: "TAMPER DETECTED",
                    quantity: totalQty,
                    time: p.updatedAt
                });
            }

        });

        /* =====================================================
           ✅ SORT (LATEST FIRST)
        ===================================================== */
        history.sort((a, b) => new Date(b.time) - new Date(a.time));

        /* =====================================================
           ✅ FINAL RESPONSE
        ===================================================== */
        res.json({
            totalEvents: history.length,
            totalReceived,
            totalSold,
            history
        });

    } catch (err) {
        console.error("Warehouse History Error:", err);

        res.status(500).json({
            totalEvents: 0,
            totalReceived: 0,
            totalSold: 0,
            history: [],
            message: "History fetch failed"
        });
    }
};