const Produce = require("../models/Produce");
const Profile = require("../models/Profile");
const Shipment = require("../models/Shipment");
const crypto = require("crypto");
const canonicalStringify = require("../utils/canonicalStringify");

const buildTransporterInvoice = require("../utils/buildTransporterInvoice");

function generateInvoiceHash(payload) {
    return crypto
        .createHash("sha256")
        .update(canonicalStringify(payload))
        .digest("hex");
}

async function fetchFarmerLocation(farmerId) {
    if (!farmerId) return "Unknown";

    const farmerProfile = await Profile.findOne({ roleId: farmerId }).lean();
    return farmerProfile?.location || "Unknown";
}

/* =========================================================
GET FARMER LOCATION + HARVEST DATE FROM BATCH
(Used for date restriction in frontend)
========================================================= */
exports.getBatchFarmerLocation = async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId?.trim()) {
            return res.status(400).json({
                message: "Batch ID required"
            });
        }

        const produce = await Produce.findOne({
            batchId: batchId.trim()
        }).lean();

        if (!produce) {
            return res.status(404).json({
                message: "Batch not found"
            });
        }

        const fromLocation = await fetchFarmerLocation(produce.farmerId);

        /* ✅ FORMAT HARVEST DATE FOR <input type="date" /> */
        let formattedHarvest = null;

        if (produce.harvestDate) {
            const harvest = new Date(produce.harvestDate);

            const year = harvest.getFullYear();
            const month = String(harvest.getMonth() + 1).padStart(2, "0");
            const day = String(harvest.getDate()).padStart(2, "0");

            formattedHarvest = `${year}-${month}-${day}`;
        }

        return res.json({
            fromLocation,
            harvestDate: formattedHarvest
        });

    } catch (err) {
        console.error("❌ FARMER LOCATION FETCH ERROR:", err);
        res.status(500).json({
            message: "Failed to fetch farmer location"
        });
    }
};

/* =========================================================
UPLOAD TRANSPORTER INVOICE
========================================================= */
exports.uploadInvoice = async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId?.trim()) {
            return res.status(400).json({
                message: "Batch ID is required"
            });
        }

        const {
            transporterName,
            transporterId,
            vehicleNumber,
            transportDate,
            charge,
            distributorName,
            distributorLocation,
            distributorId
        } = req.body;

        /* ================= VALIDATION ================= */

        if (
            !transporterName ||
            !transporterId ||
            !vehicleNumber ||
            !transportDate ||
            charge === undefined ||
            !distributorName ||
            !distributorLocation ||
            !distributorId?.trim()
        ) {
            return res.status(400).json({
                message: "All invoice fields are required"
            });
        }

        const parsedDate = new Date(transportDate);

        if (isNaN(parsedDate.getTime())) {
            return res.status(400).json({
                message: "Invalid transport date"
            });
        }

        /* ================= FETCH APPROVED BATCH ================= */

        const produce = await Produce.findOne({
            batchId: batchId.trim()
        });

        if (!produce) {
            return res.status(404).json({
                message: "Batch not found"
            });
        }

        if (produce.verificationStatus !== "APPROVED") {
            return res.status(400).json({
                message: "Rejected or unapproved batch cannot proceed"
            });
        }

        /* ================= PREVENT MULTIPLE INVOICES ================= */

        if (
            produce.transporterInvoice &&
            produce.transporterInvoice.uploadedAt
        ) {
            return res.status(400).json({
                message: "Invoice already uploaded for this batch"
            });
        }

        /* ================= STRICT DATE VALIDATION ================= */

        const harvest = new Date(produce.harvestDate);
        harvest.setHours(0, 0, 0, 0);

        const transport = new Date(transportDate);
        transport.setHours(0, 0, 0, 0);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (transport < harvest) {
            return res.status(400).json({
                message: "Transport date cannot be before harvest date"
            });
        }

        if (transport > today) {
            return res.status(400).json({
                message: "Transport date cannot be in the future"
            });
        }

        /* ================= FARMER LOCATION ================= */

        const fromLocation = await fetchFarmerLocation(produce.farmerId);

        const cleanInvoice = buildTransporterInvoice({
            transporterName,
            transporterId,
            vehicleNumber,
            transportDate,
            charge,
            fromLocation,
            toLocation: distributorLocation,
            distributorId,
            distributorName,
            distributorLocation,
            status: "APPROVED"
        });

        // 🔐 HASH FROM CLEAN STRUCTURE ONLY
        const invoiceHash = generateInvoiceHash(cleanInvoice);

        // ✅ FINAL STORED OBJECT (ONLY ADD NON-HASH FIELDS AFTER)
        const invoiceData = {
            ...cleanInvoice,
            transportDate: parsedDate, // keep Date for UI
            uploadedAt: new Date(),
            hash: invoiceHash
        };

        // ✅ CURRENT INVOICE
        produce.transporterInvoice = invoiceData;

        // 🔐 ORIGINAL SNAPSHOT (EXACT SAME STRUCTURE)
        if (
            produce.originalSnapshot &&
            !produce.originalSnapshot.transporterInvoice
        ) {
            produce.originalSnapshot.transporterInvoice =
                JSON.parse(JSON.stringify(cleanInvoice)); // 🔥 CRITICAL FIX

            produce.markModified("originalSnapshot");
        }

        produce.distributorId = distributorId.trim();
        await produce.save();

        return res.json({
            message: "Invoice uploaded successfully",
            batchId: produce.batchId
        });

    } catch (err) {
        console.error("❌ INVOICE UPLOAD ERROR:", err);
        res.status(500).json({
            message: "Upload failed"
        });
    }
};

/* =========================================================
GET ASSIGNED SHIPMENTS FOR TRANSPORTER
========================================================= */
exports.getAssignedShipments = async (req, res) => {
    try {
        const transporterId = req.headers["x-role-id"];

        if (!transporterId) {
            return res.status(401).json({
                message: "Unauthorized"
            });
        }

        const shipments = await Shipment.find({
            handlerRole: "TRANSPORTER",
            handlerId: transporterId,
            status: "ASSIGNED_TO_TRANSPORTER"
        })
            .sort({ createdAt: -1 })
            .lean();

        res.json(shipments);

    } catch (err) {
        console.error("❌ ASSIGNED SHIPMENTS ERROR:", err);

        res.status(500).json({
            message: "Failed to fetch assigned shipments"
        });
    }
};