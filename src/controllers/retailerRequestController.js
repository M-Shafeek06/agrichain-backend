const RetailerRequest = require("../models/RetailerRequest");
const RoleIdentity = require("../models/RoleIdentity");
const Produce = require("../models/Produce");
const Invoice = require("../models/Invoice");
const { verifyBatch } = require("../controllers/verifyController");

/* ===================================================
🛒 Retailer creates request
=================================================== */

exports.createRequest = async (req, res) => {
    try {
        const retailerId = req.headers["x-role-id"];
        if (!retailerId)
            return res.status(401).json({ message: "Unauthorized" });

        const { distributorId, batchId, quantity } = req.body;

        const retailer = await RoleIdentity.findOne({ roleId: retailerId });
        const distributor = await RoleIdentity.findOne({ roleId: distributorId });
        const produce = await Produce.findOne({ batchId });

        if (!retailer || !distributor || !produce)
            return res.status(404).json({ message: "Invalid request data" });

        // 🔒 BLOCK REJECTED / INVALIDATED
        if (produce.verificationStatus !== "APPROVED") {
            return res.status(400).json({
                message: "Cannot request rejected or unapproved batch"
            });
        }

        if (produce.state !== "OWNED_BY_DISTRIBUTOR") {
            return res.status(400).json({
                message: "Produce not available for request"
            });
        }

        if (quantity <= 0) {
            return res.status(400).json({
                message: "Invalid quantity"
            });
        }

        // 🔥 NEW LOGIC
        const MIN_ORDER = 50;

        // 🔥 UPDATED LOGIC
        if (produce.remainingQuantity >= MIN_ORDER) {
            // Normal case → enforce minimum 50 kg
            if (quantity < MIN_ORDER) {
                return res.status(400).json({
                    message: `Minimum order quantity is ${MIN_ORDER} kg`
                });
            }
        } else {
            // Low stock → must take full remaining
            if (quantity !== produce.remainingQuantity) {
                return res.status(400).json({
                    message: `Only full remaining stock (${produce.remainingQuantity} kg) can be requested`
                });
            }
        }

        /* -------------------------------------------
        Prevent SAME retailer duplicate requests
        ------------------------------------------- */

        const existingRequest = await RetailerRequest.findOne({
            batchId,
            retailerId,
            status: { $in: ["REQUESTED", "APPROVED"] }
        });

        if (existingRequest) {
            return res.status(400).json({
                message: "You already have an active request for this batch"
            });
        }

        /* -------------------------------------------
        Prevent OVERBOOKING (multiple retailers)
        ------------------------------------------- */

        const pendingRequests = await RetailerRequest.aggregate([
            {
                $match: {
                    batchId,
                    status: { $in: ["REQUESTED", "APPROVED"] }
                }
            },
            {
                $group: {
                    _id: null,
                    totalRequested: { $sum: "$requestedQty" }
                }
            }
        ]);

        const alreadyRequested =
            pendingRequests.length > 0 ? pendingRequests[0].totalRequested : 0;

        if (alreadyRequested + quantity > produce.remainingQuantity) {
            return res.status(400).json({
                message: "Requested quantity exceeds remaining stock"
            });
        }

        const request = await RetailerRequest.create({
            retailerId,
            retailerName: retailer.name,
            distributorId,
            distributorName: distributor.name,
            batchId,
            cropName: produce.cropName,
            requestedQty: quantity
        });

        res.json({
            message: "Request created",
            requestId: request.requestId
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Request failed" });
    }
};


/* ===================================================
🧾 Retailer views own requests
=================================================== */

exports.getMyRequests = async (req, res) => {
    try {
        const retailerId = req.headers["x-role-id"];

        const rows = await RetailerRequest.find({ retailerId })
            .sort({ createdAt: -1 })
            .lean();

        /* 🔥 ATTACH SESSION 2 INVOICE */
        const enriched = await Promise.all(
            rows.map(async (r) => {

                const produce = await Produce.findOne({ batchId: r.batchId });

                let integrityStatus = "SAFE";

                try {
                    const verification = await verifyBatch(r.batchId);

                    if (
                        verification &&
                        (
                            verification.status === "TAMPERED" ||
                            verification.integrityStatus === "TAMPERED"
                        )
                    ) {
                        integrityStatus = "TAMPERED";
                    }

                } catch (err) {
                    console.error("Verification failed:", err);
                }

                /* 🔥 FALLBACK TO DB (VERY IMPORTANT) */
                if (produce?.integrityStatus === "TAMPERED") {
                    integrityStatus = "TAMPERED";
                }

                return {
                    ...r,
                    invoiceId: r.invoiceId || null,

                    // ✅ IMPORTANT CHANGE
                    integrityStatus,   // ← dynamic (NOT from DB)

                    verificationStatus: produce?.verificationStatus || "UNKNOWN"
                };
            })
        );

        res.json(enriched);

    } catch (err) {
        console.error("Fetch failed:", err);
        res.status(500).json({ message: "Fetch failed" });
    }
};

/* ===================================================
📥 Distributor views incoming requests
=================================================== */

exports.getDistributorRequests = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];

        const rows = await RetailerRequest.find({
            distributorId
        }).sort({ createdAt: -1 });

        res.json(rows);

    } catch (err) {
        res.status(500).json({ message: "Fetch failed" });
    }
};

/* ===================================================
✅ Distributor approve/reject
=================================================== */

exports.updateRequestStatus = async (req, res) => {
    try {
        const distributorId = req.headers["x-role-id"];
        const { status, remark } = req.body;

        const request = await RetailerRequest.findOne({
            requestId: req.params.id,
            distributorId
        });

        const produce = await Produce.findOne({ batchId: request.batchId });

        // 🔒 BLOCK APPROVAL ON INVALID BATCH
        if (produce && produce.verificationStatus !== "APPROVED") {
            return res.status(400).json({
                message: "Cannot process request for rejected batch"
            });
        }

        if (!request)
            return res.status(404).json({
                message: "Request not found"
            });

        const allowed = ["APPROVED", "REJECTED"];

        if (!allowed.includes(status)) {
            return res.status(400).json({ message: "Invalid status transition" });
        }

        request.status = status;

        request.distributorRemark = remark || "";
        await request.save();

        res.json({ message: "Updated" });

    } catch (err) {
        res.status(500).json({ message: "Update failed" });
    }
};
