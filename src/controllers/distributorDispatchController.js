const Shipment = require("../models/Shipment");
const Produce = require("../models/Produce");
const RetailerRequest = require("../models/RetailerRequest");
const Invoice = require("../models/Invoice");
const crypto = require("crypto");
const canonicalStringify = require("../utils/canonicalStringify");
const RoleIdentity = require("../models/RoleIdentity");

/* =========================================================
   🔐 HASH GENERATOR
========================================================= */

const generateBlockHash = (payload) =>
    crypto
        .createHash("sha256")
        .update(canonicalStringify(payload))
        .digest("hex");

/* =========================================================
   ✅ GET DISPATCH LIST
========================================================= */

exports.getDispatchList = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];

        if (!distributorId)
            return res.status(401).json({ message: "Unauthorized" });

        // Get approved retailer requests
        const approvedRequests = await RetailerRequest.find({
            distributorId,
            status: "APPROVED"
        }).lean();

        if (!approvedRequests.length)
            return res.json([]);

        const batchIds = approvedRequests.map(r => r.batchId);

        // Get matching produce owned by distributor
        const produceList = await Produce.find({
            batchId: { $in: batchIds },
            currentOwnerId: distributorId
        }).lean();

        if (!produceList.length)
            return res.json([]);

        const result = approvedRequests.map(request => {

            const produce = produceList.find(
                p => p.batchId === request.batchId
            );

            if (!produce) return null;

            const totalQty = produce.totalQuantity || 0;
            const totalCost = produce.distributorTotalCost || 0;

            let requestedCost = 0;

            if (totalQty > 0) {
                const unitCost = totalCost / totalQty;
                requestedCost = unitCost * request.requestedQty;
            }

            return {
                _id: request._id,
                requestId: request.requestId,
                batchId: request.batchId,
                cropName: request.cropName,
                requestedQty: request.requestedQty,
                retailerId: request.retailerId,
                retailerName: request.retailerName,
                status: request.status,
                basePrice: produce.basePrice,
                distributorAcceptedBasePrice: produce.distributorAcceptedBasePrice,
                totalQuantity: produce.totalQuantity,
                distributorTotalCost: produce.distributorTotalCost,
                initialTransportCost: produce.initialTransportCost || 0,
                requestedCost: requestedCost.toFixed(2)
            };

        }).filter(Boolean);

        return res.json(result);

    } catch (err) {
        console.error("Dispatch list error:", err);
        return res.status(500).json({ message: "Fetch failed" });
    }
};


/* =========================================================
   ✅ DISPATCH TO RETAILER (FINAL SAFE VERSION)
========================================================= */

exports.dispatchToRetailer = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];
        const requestId = req.params.id;

        if (!distributorId)
            return res.status(401).json({ message: "Unauthorized" });

        const {
            transporterId,
            transporterName,
            vehicleNumber,
            transportDate,
            charge
        } = req.body;

        if (Number(charge) > 10000) {
            return res.status(400).json({
                message: "Transport charge cannot exceed ₹10,000"
            });
        }

        if (
            !transporterId ||
            !transporterName ||
            !vehicleNumber ||
            !transportDate ||
            !charge
        ) {
            return res.status(400).json({
                message: "All invoice fields required"
            });
        }


        /* ================= VALIDATE RETAILER REQUEST ================= */

        const request = await RetailerRequest.findOne({
            requestId,
            distributorId,
            status: "APPROVED"
        });

        if (!request) {
            return res.status(400).json({
                message: "Invalid or already dispatched request"
            });
        }


        /* ================= VALIDATE PRODUCE ================= */

        const produce = await Produce.findOne({
            batchId: request.batchId,
            currentOwnerId: distributorId,
            state: "OWNED_BY_DISTRIBUTOR"
        });

        if (!produce)
            return res.status(404).json({
                message: "Batch not found in distributor inventory"
            });

        /* ================= QUANTITY VALIDATION ================= */

        const qty = request.requestedQty;

        if (!qty || qty <= 0) {
            return res.status(400).json({
                message: "Invalid requested quantity"
            });
        }

        if (produce.reservedQuantity < qty) {
            return res.status(400).json({
                message: "Insufficient reserved stock for dispatch"
            });
        }
        /* ================= COST LOCK (BYPASS VALIDATION SAFELY) ================= */

        if (!produce.costLocked) {
            const transportCost = Number(charge) || 0;

            const totalCost =
                (produce.totalQuantity * produce.basePrice) + transportCost;

            await Produce.updateOne(
                { _id: produce._id },
                {
                    $set: {
                        initialTransportCost: transportCost,
                        distributorTotalCost: totalCost,
                        costLocked: true
                    }
                }
            );

            // 🔁 IMPORTANT: refresh produce
            produce.initialTransportCost = transportCost;
            produce.distributorTotalCost = totalCost;
            produce.costLocked = true;
        }
        /* ================= TRANSPORT DATE VALIDATION ================= */

        const transport = new Date(transportDate);
        const accepted = new Date(produce.distributorAcceptedAt);
        const today = new Date();

        const transportDay = transport.toISOString().split("T")[0];
        const acceptedDay = accepted.toISOString().split("T")[0];
        const todayDay = today.toISOString().split("T")[0];

        if (transportDay < acceptedDay) {
            return res.status(400).json({
                message: "Transport date cannot be before distributor acceptance date"
            });
        }

        if (transportDay > todayDay) {
            return res.status(400).json({
                message: "Transport date cannot be in the future"
            });
        }
        /* ================= STATE TRANSITION ================= */

        produce.state = "RETAILER_REQUESTED";

        // ownership stays with distributor
        produce.currentOwnerRole = "DISTRIBUTOR";
        produce.currentOwnerId = distributorId;

        produce.requestedRetailerId = request.retailerId;

        /* ================= FETCH LOCATIONS ================= */

        const distributor = await RoleIdentity.findOne({ roleId: distributorId });
        const retailer = await RoleIdentity.findOne({ roleId: request.retailerId });

        const fromLocation = distributor?.location || "Unknown";
        const toLocation = retailer?.location || "Unknown";

        /* ================= CREATE INVOICE ================= */

        const invoiceId =
            "INV-" + crypto.randomBytes(3).toString("hex").toUpperCase();

        const invoicePayload = {
            invoiceId,
            batchId: request.batchId,
            distributorId,
            retailerId: request.retailerId,
            cropName: produce.cropName,
            transporterName,
            transporterId,
            vehicleNumber,
            transportDate,
            charge: Number(charge),
            fromLocation,
            toLocation
        };

        const hash = generateBlockHash(invoicePayload);

        const invoice = await Invoice.create({
            invoiceId,
            ...invoicePayload,
            shippedQuantity: qty,
            hash,
            originalPayload: invoicePayload
        });

        await RetailerRequest.updateOne(
            { _id: request._id },
            { invoiceId: invoiceId }
        );

        /* ================= PROFIT CALCULATION ================= */

        const basePrice = produce.basePrice || 0;
        const PROFIT_PERCENT = 0.15;

        const baseGoodsCost = basePrice * qty;
        const profitAmount = baseGoodsCost * PROFIT_PERCENT;

        produce.distributorProfit =
            (produce.distributorProfit || 0) + profitAmount;

        /* ================= SAVE PRODUCE ================= */

        await Produce.updateOne(
            { _id: produce._id },
            {
                $set: {
                    state: produce.state,
                    currentOwnerRole: produce.currentOwnerRole,
                    currentOwnerId: produce.currentOwnerId,
                    requestedRetailerId: produce.requestedRetailerId,
                    distributorProfit: produce.distributorProfit
                },
                $inc: {
                    reservedQuantity: -qty,
                    inTransitQuantity: qty
                }
            }
        );

        /* ================= LOCK REQUEST ================= */

        await RetailerRequest.updateOne(
            { _id: request._id, status: "APPROVED" },
            { $set: { status: "DISPATCHED" } }
        );

        /* ================= BLOCKCHAIN ENTRY (FINAL FIXED) ================= */

        const lastShipment = await Shipment.findOne({
            batchId: request.batchId
        }).sort({ createdAt: -1 });

        let shipmentSessionId;
        let previousHash;

        if (!lastShipment) {
            shipmentSessionId = "SESSION-" + crypto.randomUUID().slice(0, 8);
            previousHash = "GENESIS";
        } else {
            previousHash = lastShipment.blockHash;
            shipmentSessionId = "SESSION-" + crypto.randomUUID().slice(0, 8);
        }
        // 🔗 Payload
        const payload = {
            batchId: request.batchId,
            invoiceId: invoiceId,

            handlerRole: "DISTRIBUTOR",
            handlerId: distributorId,
            handlerName: distributor?.name || "Distributor",

            transporterId: transporterId,
            retailerId: request.retailerId,
            distributorId: distributorId,

            cropName: produce.cropName,
            shipmentSessionId,
            shipmentQuantity: request.requestedQty,

            status: "ASSIGNED_TO_TRANSPORTER",
            location: fromLocation,

            previousHash
        };

        // 🧱 Create block
        const block = await Shipment.create({
            ...payload,
            blockHash: generateBlockHash(payload),
            isValid: true,
            distance: 0
        });

        const updateTrustScore = require("../utils/updateTrustScore");

        await updateTrustScore({
            roleId: distributorId,
            isValid: true,
            batchId: request.batchId,
            reason: "Successful dispatch to retailer"
        });

        /* ================= SUCCESS RESPONSE ================= */
        const updatedProduce = await Produce.findOne({
            batchId: request.batchId
        }).lean();

        return res.status(200).json({
            success: true,
            message: "Dispatch successful",
            invoiceId: invoice.invoiceId,
            remainingStock: updatedProduce.remainingQuantity,
            blockId: block._id
        });

    } catch (err) {
        console.error("Dispatch error:", err);
        return res.status(500).json({
            success: false,
            message: "Dispatch failed",
            error: err.message
        });
    }
};  