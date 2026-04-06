const express = require("express");
const router = express.Router();

const { registerFarmer } = require("../controllers/farmerController");
const Produce = require("../models/Produce");

/* 🔐 SECURITY MIDDLEWARE */
const verifyToken = require("../../middleware/verifyToken");
const allowRoles = require("../../middleware/allowRoles");

/* ======================================================
   FARMER REGISTRATION (Public Route)
====================================================== */

router.post("/register", registerFarmer);


/* ======================================================
   🔐 GET FARMER PRODUCE HISTORY (FARMER ONLY)
   Prevents ID tampering
====================================================== */

router.get(
  "/history/:farmerId",
  verifyToken,
  allowRoles("FARMER"),
  async (req, res) => {
    try {

      const { farmerId } = req.params;

      /* ---------- Basic Validation ---------- */
      if (!farmerId || typeof farmerId !== "string") {
        return res.status(400).json({
          message: "Farmer ID is required"
        });
      }

      /* ---------- Prevent ID Tampering ---------- */
      if (req.user.roleId !== farmerId) {
        return res.status(403).json({
          message: "Access denied. You can only view your own history"
        });
      }

      /* ---------- Fetch Produce ---------- */
      const produces = await Produce.find({ farmerId })
        .sort({ createdAt: -1 })
        .lean();

      /* ---------- Always Return Array ---------- */
      if (!Array.isArray(produces) || produces.length === 0) {
        return res.status(200).json([]);
      }

      /* ---------- Enrich Records ---------- */
      const enrichedHistory = produces.map(p => {

        const invoice = p.transporterInvoice ?? null;

        return {
          ...p,

          transporterInvoice: invoice,

          invoiceAvailable: Boolean(invoice),
          invoiceStatus: invoice?.status || null
        };

      });

      return res.status(200).json(enrichedHistory);

    } catch (err) {

      console.error("❌ Farmer History Fetch Error:", err);

      return res.status(500).json({
        message: "Failed to fetch farmer history"
      });

    }
  }
);

module.exports = router;