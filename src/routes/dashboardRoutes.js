const express = require("express");
const router = express.Router();

const {
  getAdminAnalytics,
  getTrustLeaderboard
} = require("../controllers/adminController");

/* ================= DASHBOARD ================= */

router.get("/stats", getAdminAnalytics);

/* ================= TRUST ================= */

router.get("/trust-leaderboard", getTrustLeaderboard);

module.exports = router;