const RetailerRequest = require("../models/RetailerRequest");
const Produce = require("../models/Produce");

/* ================= GET INCOMING REQUESTS ================= */

exports.getIncomingRequests = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];

        if (!distributorId)
            return res.status(401).json({ message: "Unauthorized" });

        const requests = await RetailerRequest.find({
            distributorId
        }).sort({ createdAt: -1 });

        res.json(requests);

    } catch (err) {
        console.error("Request fetch error:", err);
        res.status(500).json({ message: "Failed to fetch requests" });
    }
};

exports.approveRequest = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];
        const requestId = req.params.id;

        if (!distributorId)
            return res.status(401).json({ message: "Unauthorized" });

        const request = await RetailerRequest.findById(requestId);
        if (!request)
            return res.status(404).json({ message: "Request not found" });

        if (request.distributorId !== distributorId)
            return res.status(403).json({ message: "Access denied" });

        if (request.status !== "REQUESTED")
            return res.status(400).json({ message: "Already processed" });

        const produce = await Produce.findOne({
            batchId: request.batchId,
            currentOwnerId: distributorId
        });

        if (!produce)
            return res.status(404).json({ message: "Batch not found in inventory" });

        // 🔒 STRICT STOCK CHECK
        if (produce.remainingQuantity < request.requestedQty)
            return res.status(400).json({
                message: "Insufficient stock"
            });

        /* =====================================================
           ✅ STOCK REDUCTION MOVED TO APPROVAL STAGE
        ===================================================== */

        produce.reservedQuantity = (produce.reservedQuantity || 0) + request.requestedQty;

        await produce.save(); // pre-save recalculates remainingQuantity safely

        request.status = "APPROVED";
        await request.save();

        return res.status(200).json({
            success: true,
            message: "Request approved & stock reserved",
            remainingStock: produce.remainingQuantity
        });

    } catch (err) {
        console.error("Approve error:", err);
        return res.status(500).json({
            success: false,
            message: "Approval failed"
        });
    }
};

exports.rejectRequest = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];

        const request = await RetailerRequest.findOne({
            _id: req.params.id,
            distributorId
        });

        if (!request) {
            return res.status(404).json({
                message: "Request not found"
            });
        }

        // 🔥 ONLY update request (NO produce touch)
        request.status = "REJECTED";
        await request.save();

        return res.json({
            message: "Request rejected successfully"
        });

    } catch (err) {
        console.error("Reject error:", err);
        res.status(500).json({
            message: "Reject failed"
        });
    }
};