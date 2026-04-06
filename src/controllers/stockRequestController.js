const StockRequest = require("../models/StockRequest");
const Produce = require("../models/Produce");
const RoleIdentity = require("../models/RoleIdentity");
const crypto = require("crypto");

/* =====================================
   RETAILER: CREATE REQUEST
===================================== */

exports.createRequest = async (req, res) => {
    try {
        const retailerId = req.headers["x-role-id"];
        const { distributorId, batchId, quantity } = req.body;

        if (!retailerId)
            return res.status(401).json({ message: "Unauthorized" });

        const produce = await Produce.findOne({ batchId });

        if (!produce)
            return res.status(404).json({ message: "Batch not found" });

        if (quantity > produce.remainingQuantity)
            return res.status(400).json({
                message: "Requested quantity exceeds stock"
            });

        const retailer = await RoleIdentity.findOne({ roleId: retailerId });
        const distributor = await RoleIdentity.findOne({
            roleId: distributorId
        });

        const requestId =
            "REQ-" + crypto.randomUUID().slice(0, 8);

        const request = await StockRequest.create({
            requestId,
            batchId,
            cropName: produce.cropName,
            requestedQty: quantity,
            retailerId,
            retailerName: retailer?.name,
            distributorId,
            distributorName: distributor?.name
        });

        res.json({
            message: "Request sent successfully",
            requestId: request.requestId
        });

    } catch (err) {
        console.error("REQUEST ERROR:", err);
        res.status(500).json({ message: "Request failed" });
    }
};

exports.getRetailerRequests = async (req, res) => {
    try {
        const retailerId = req.headers["x-role-id"];

        const requests = await StockRequest.find({
            retailerId
        }).sort({ createdAt: -1 });

        res.json(requests);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Failed to load requests"
        });
    }
};

exports.getDistributorRequests = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];

        const requests = await StockRequest.find({
            distributorId
        }).sort({ createdAt: -1 });

        res.json(requests);

    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Failed to load distributor requests"
        });
    }
};
