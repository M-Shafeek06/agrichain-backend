const express = require("express");
const router = express.Router();
const { downloadCertificate } = require("../controllers/certificateController");

/**
 * 🔐 Download Final Verification Certificate (PDF)
 * Route: GET /api/certificate/download/:batchId
 */
router.get("/download/:batchId", async (req, res) => {
  try {
    await downloadCertificate(req, res);
  } catch (err) {
    console.error("CERTIFICATE ROUTE ERROR:", err);
    res.status(500).json({
      status: "ERROR",
      message: "Unable to generate certificate"
    });
  }
});

module.exports = router;
