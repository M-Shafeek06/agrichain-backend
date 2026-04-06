const express = require("express");
const router = express.Router();

const RoleIdentity = require("../models/RoleIdentity");

/* 🔐 SECURITY MIDDLEWARE */
const verifyToken = require("../../middleware/verifyToken");
const allowRoles = require("../../middleware/allowRoles");

const {
    uploadInvoice,
    getBatchFarmerLocation,
    getAssignedShipments
} = require("../controllers/transporterController");


/* ======================================================
   FETCH TRANSPORTER SUPPORT INFO (ENHANCED — SAFE)
   (Public route – keeping unchanged to avoid breaking UI)
====================================================== */

router.get("/support-info", async (req, res) => {
    try {
        const transporters = await RoleIdentity.find({
            role: { $regex: "^TRANSPORTER$", $options: "i" }
        }).select(
            "name location emergencyContact roleId vehicleNumber vehicleType capacity"
        );

        if (!transporters || transporters.length === 0) {
            return res.json([]); // safe empty response
        }

        const formatted = transporters.map(t => ({
            name: t.name || "Unknown",
            location: t.location || "Unknown",
            phone: t.emergencyContact || "N/A",
            roleId: t.roleId,

            vehicleNumber: t.vehicleNumber || "Not Available",
            vehicleType: t.vehicleType || "Not Available",
            capacity: t.capacity || null
        }));

        res.json(formatted);

    } catch (err) {
        console.error("Transporter fetch error:", err);
        res.status(500).json({ message: "Server error" });
    }
});


/* ======================================================
   🔐 GET ASSIGNED SHIPMENTS (TRANSPORTER ONLY)
====================================================== */

router.get(
    "/assigned",
    verifyToken,
    allowRoles("TRANSPORTER"),
    getAssignedShipments
);


/* ======================================================
   🔐 UPLOAD TRANSPORT INVOICE
====================================================== */

router.post(
    "/invoice/:batchId",
    verifyToken,
    allowRoles("TRANSPORTER"),
    uploadInvoice
);


/* ======================================================
   🔐 GET FARMER LOCATION FOR A BATCH
====================================================== */

router.get(
    "/batch-location/:batchId",
    verifyToken,
    allowRoles("TRANSPORTER"),
    getBatchFarmerLocation
);


module.exports = router;