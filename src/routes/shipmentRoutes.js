const express = require("express");
const router = express.Router();

const shipmentController = require("../controllers/shipmentController");
const Shipment = require("../models/Shipment");


/* =====================================================
   🔹 CREATE / UPDATE SHIPMENT
===================================================== */
router.post("/update", shipmentController.updateShipment);

router.get(
    "/transporter/:transporterId",
    shipmentController.getTransporterShipments
);


router.get(
    "/transporter-recent/:transporterId",
    shipmentController.getTransporterRecent
);

router.get(
    "/transporter-live/:transporterId",
    shipmentController.getTransporterLiveRoutes
);

// START TRANSPORT (Farmer)
router.post("/start-transport", shipmentController.startTransport);

router.post(
    "/distributor/accept/:shipmentId",
    shipmentController.acceptAtDistributor
);

const distributorController = require("../controllers/distributorController");

router.post(
    "/distributor/confirm-base-price",
    distributorController.confirmBasePrice
);


router.post(
    "/retailer/confirm/:shipmentId",
    shipmentController.confirmRetailerDelivery
);

/* =====================================================
   🔹 TRANSPORTER DASHBOARD – OVERVIEW STATS (FINAL)
===================================================== */
router.get("/transporter/stats/:id", async (req, res) => {
    try {
        const transporterId = req.params.id;
        if (!transporterId) {
            return res.json({ active: 0, verified: 0, tampered: 0, distance: 0 });
        }

        // 1️⃣ Get ALL transporter blocks
        const blocks = await Shipment.find({
            handlerRole: "TRANSPORTER",
            handlerId: transporterId
        }).lean();

        if (!blocks.length) {
            return res.json({ active: 0, verified: 0, tampered: 0, distance: 0 });
        }

        // 2️⃣ Group by session
        const sessions = {};

        blocks.forEach(block => {
            const sessionKey = block.shipmentSessionId || block.batchId;

            if (!sessions[sessionKey]) {
                sessions[sessionKey] = [];
            }

            sessions[sessionKey].push(block);
        });

        let active = 0;
        let verified = 0;
        let tampered = 0;
        let totalDistance = 0;

        Object.values(sessions).forEach(sessionBlocks => {

            // sort chronological
            sessionBlocks.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            const latest = sessionBlocks[sessionBlocks.length - 1];

            // 🔹 ACTIVE = only if session still moving
            if (["PICKED_UP", "IN_TRANSIT"].includes(latest.status)) {
                active++;
            }

            // 🔹 VERIFIED / TAMPERED per session
            if (latest.chainValid === true) verified++;
            if (latest.chainValid === false) tampered++;

            // 🔹 Distance = sum ALL blocks
            sessionBlocks.forEach(b => {
                totalDistance += Number(b.distance) || 0;
            });
        });

        res.json({
            active,
            verified,
            tampered,
            distance: Math.round(totalDistance)
        });

    } catch (err) {
        console.error("Stats error:", err);
        res.status(500).json({ error: "Failed to load transporter stats" });
    }
});

/* =====================================================
   🔹 RECENT SHIPMENTS – TRANSPORTER (MAP + TIMELINE)
===================================================== */
router.get("/recent/:id", async (req, res) => {
    try {
        const transporterId = req.params.id;
        if (!transporterId) return res.json([]);

        const data = await Shipment.aggregate([
            {
                $match: {
                    handlerRole: "TRANSPORTER",
                    handlerId: transporterId,
                    status: { $in: ["PICKED_UP", "IN_TRANSIT", "AT_DISTRIBUTOR"] }
                }
            },

            { $sort: { createdAt: 1 } },

            {
                $group: {
                    _id: {
                        batchId: "$batchId",
                        session: {
                            $ifNull: ["$shipmentSessionId", "$batchId"]
                        }
                    },
                    history: {
                        $push: {
                            status: "$status",
                            location: "$location",
                            lat: "$lat",
                            lng: "$lng",
                            updatedAt: "$updatedAt",
                            isValid: "$isValid"
                        }
                    },
                    latestDoc: { $last: "$$ROOT" }
                }
            },

            { $sort: { "latestDoc.updatedAt": -1 } },

            { $limit: 10 },

            {
                $lookup: {
                    from: "produces",
                    localField: "_id.batchId",
                    foreignField: "batchId",
                    as: "produce"
                }
            },

            {
                $addFields: {
                    cropName: { $arrayElemAt: ["$produce.cropName", 0] },
                    latest: {
                        location: "$latestDoc.location",
                        lat: "$latestDoc.lat",
                        lng: "$latestDoc.lng",
                        status: "$latestDoc.status",
                        updatedAt: "$latestDoc.updatedAt",
                        isValid: "$latestDoc.isValid"
                    }
                }
            },

            { $project: { produce: 0, latestDoc: 0 } }
        ]);

        res.json(data);
    } catch (err) {
        console.error("Recent shipment fetch error:", err.message);
        res.status(500).json({ message: "Failed to fetch recent shipments" });
    }
});

/* =====================================================
   🔹 RETAILER RECENT UPDATES
===================================================== */
router.get("/recent/retailer/:retailerId", async (req, res) => {
    try {
        const { retailerId } = req.params;

        const data = await Shipment.aggregate([
            { $match: { handlerRole: "RETAILER", handlerId: retailerId } },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: "$batchId",
                    latest: { $last: "$$ROOT" }
                }
            },
            { $sort: { "latest.createdAt": -1 } },
            { $limit: 4 },
            {
                $lookup: {
                    from: "produces",
                    localField: "_id",
                    foreignField: "batchId",
                    as: "produce"
                }
            },
            {
                $addFields: {
                    cropName: { $arrayElemAt: ["$produce.cropName", 0] }
                }
            },
            { $project: { produce: 0 } }
        ]);

        res.json(data);
    } catch (err) {
        console.error("Retailer recent error:", err.message);
        res.status(500).json({ message: "Failed to fetch retailer recent updates" });
    }
});

/* =====================================================
   🔹 RETAILER HISTORY
   🔹 (PLACED BEFORE TRANSPORTER HISTORY)
===================================================== */
router.get("/history/retailer/:retailerId", async (req, res) => {
    try {
        const { retailerId } = req.params;

        const shipments = await Shipment.aggregate([
            { $match: { retailerId } },   // ✅ FIXED
            { $sort: { createdAt: -1 } },
            {
                $lookup: {
                    from: "produces",
                    localField: "batchId",
                    foreignField: "batchId",
                    as: "produce"
                }
            },
            {
                $addFields: {
                    cropName: { $arrayElemAt: ["$produce.cropName", 0] },
                    quantity: { $arrayElemAt: ["$produce.quantity", 0] }
                }
            },
            { $project: { produce: 0 } }
        ]);

        res.json(shipments);
    } catch (err) {
        console.error("Retailer history error:", err.message);
        res.status(500).json({ message: "Failed to fetch retailer history" });
    }
});

/* =====================================================
   🔹 DISTRIBUTOR – INCOMING SHIPMENT HISTORY (SESSION BASED)
===================================================== */
router.get("/history/distributor/:id", async (req, res) => {
    try {
        const distributorId = req.params.id;

        const data = await Shipment.aggregate([
            {
                $match: {
                    distributorId,
                    status: "AT_DISTRIBUTOR"
                }
            },
            { $sort: { createdAt: -1 } },

            {
                $lookup: {
                    from: "shipments",
                    let: { session: "$shipmentSessionId" },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: ["$shipmentSessionId", "$$session"]
                                }
                            }
                        },
                        { $sort: { createdAt: 1 } },
                        { $limit: 1 }
                    ],
                    as: "origin"
                }
            },

            {
                $addFields: {
                    fromLocation: {
                        $arrayElemAt: ["$origin.location", 0]
                    }
                }
            },

            { $project: { origin: 0 } }
        ]);

        res.json(data);

    } catch (err) {
        console.error("Distributor history error:", err);
        res.status(500).json({ message: "Failed to fetch history" });
    }
});

/* =====================================================
   🔹 DISTRIBUTOR – INCOMING (STATE BASED – CORRECT)
===================================================== */
router.get("/incoming/:distributorId", async (req, res) => {
    try {
        const { distributorId } = req.params;

        if (!distributorId) {
            return res.json([]);
        }

        const Produce = require("../models/Produce");

        const incomingProduce = await Produce.find({
            distributorId,
            state: { $in: ["IN_TRANSPORT_TO_DISTRIBUTOR", "OWNED_BY_DISTRIBUTOR"] }
        }).lean();

        res.json(incomingProduce);

    } catch (err) {
        console.error("Incoming fetch error:", err);
        res.status(500).json({
            message: "Failed to fetch incoming shipments"
        });
    }
});

/* =====================================================
   🔹 TRANSPORTER – FULL TRANSPORT HISTORY (SESSION SAFE)
   (MATCHES FRONTEND EXACTLY)
===================================================== */
router.get("/history/:transporterId", async (req, res) => {
    try {
        const { transporterId } = req.params;

        if (!transporterId) {
            return res.json([]);
        }

        const logs = await Shipment.find({
            handlerRole: "TRANSPORTER",
            handlerId: transporterId
        })
            .sort({ createdAt: 1 }) // chronological
            .lean();

        if (!logs.length) {
            return res.json([]);
        }

        const history = [];

        // 🔐 Track previous location PER SESSION (not batch)
        const lastLocationBySession = {};

        for (const block of logs) {

            const sessionKey =
                block.shipmentSessionId || block.batchId;

            const prevLocation =
                lastLocationBySession[sessionKey];

            const fromLocation =
                prevLocation ||
                (block.status === "PICKED_UP"
                    ? block.location
                    : "—");

            const toLocation = block.location || "—";

            history.push({
                _id: block._id,
                batchId: block.batchId,
                shipmentSessionId: block.shipmentSessionId || null, // ✅ added for clarity
                cropName: block.cropName,
                quantity: block.shipmentQuantity,
                fromLocation,
                toLocation,
                distanceKm: Number(block.distance) || 0,
                shipmentStatus: block.status,
                integrityStatus: block.chainValid === false
                    ? "TAMPERED"
                    : "SAFE",
                date: block.createdAt
            });

            // 🔁 Update session tracker
            lastLocationBySession[sessionKey] = block.location;
        }

        res.json(history);

    } catch (err) {
        console.error("TRANSPORT HISTORY ERROR:", err);
        res.status(500).json({
            message: "Failed to load transport history"
        });
    }
});


/* =====================================================
   🔹 TRANSPORTER ADVANCED ANALYTICS (FINAL)
===================================================== */
router.get("/transporter/analytics/:id", async (req, res) => {
    try {
        const handlerId = req.params.id;
        if (!handlerId) return res.json({});

        const blocks = await Shipment.find({
            handlerRole: "TRANSPORTER",
            handlerId
        }).lean();

        if (!blocks.length) {
            return res.json({
                stageCount: {
                    PICKED_UP: 0,
                    IN_TRANSIT: 0,
                    AT_DISTRIBUTOR: 0,
                    DELIVERED: 0
                },
                avgDelivery: "0.00",
                totalDistance: 0,
                tampered: 0,
                topRoutes: []
            });
        }

        /* ================= RAW STAGE COUNT (NO GROUPING) ================= */

        const stageCount = {
            PICKED_UP: 0,
            IN_TRANSIT: 0,
            AT_DISTRIBUTOR: 0,
            DELIVERED: 0
        };

        let totalDistance = 0;
        let tampered = 0;

        blocks.forEach(block => {

            if (block.status === "PICKED_UP") stageCount.PICKED_UP++;
            if (block.status === "IN_TRANSIT") stageCount.IN_TRANSIT++;
            if (block.status === "AT_DISTRIBUTOR") stageCount.AT_DISTRIBUTOR++;
            if (block.status === "DELIVERED") stageCount.DELIVERED++;

            totalDistance += Number(block.distance) || 0;

            if (block.chainValid === false) tampered++;
        });

        /* ================= SESSION GROUPING ONLY FOR ROUTE + DELIVERY ================= */

        const sessionGroups = {};
        const routeMap = {};
        const deliveryTimes = [];

        blocks.forEach(block => {
            const key = block.shipmentSessionId || block.batchId;

            if (!sessionGroups[key]) sessionGroups[key] = [];
            sessionGroups[key].push(block);
        });

        Object.values(sessionGroups).forEach(history => {

            history.sort((a, b) =>
                new Date(a.createdAt) - new Date(b.createdAt)
            );

            // Route transitions
            for (let i = 1; i < history.length; i++) {
                const from = history[i - 1].location;
                const to = history[i].location;

                if (from && to && from !== to) {
                    const routeKey = `${from} To ${to}`;
                    routeMap[routeKey] =
                        (routeMap[routeKey] || 0) + 1;
                }
            }

            // Delivery time
            const picked = history.find(h => h.status === "PICKED_UP");
            const delivered = history.find(h =>
                h.status === "AT_DISTRIBUTOR" ||
                h.status === "DELIVERED"
            );

            if (picked && delivered) {
                const hours =
                    (new Date(delivered.createdAt) -
                        new Date(picked.createdAt)) / 3600000;

                if (hours > 0) deliveryTimes.push(hours);
            }
        });

        const avgDelivery =
            deliveryTimes.length > 0
                ? (
                    deliveryTimes.reduce((a, b) => a + b, 0) /
                    deliveryTimes.length
                ).toFixed(2)
                : "0.00";

        res.json({
            stageCount,
            avgDelivery,
            totalDistance: Math.round(totalDistance),
            tampered,
            topRoutes: Object.entries(routeMap)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
        });

    } catch (err) {
        console.error("Analytics error:", err);
        res.status(500).json({ error: "Failed analytics" });
    }
});

module.exports = router;