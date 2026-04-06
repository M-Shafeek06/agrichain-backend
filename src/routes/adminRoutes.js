const express = require("express");
const router = express.Router();

/* ================= MIDDLEWARE ================= */
const verifyToken = require("../../middleware/verifyToken");
const verifyAdmin = require("../../middleware/verifyAdmin");

/* ================= CONTROLLER ================= */
const {
    getAdminAnalytics,
    approveProduce,
    confirmTamper,
    confirmTransporterCollection,
    simulateAttack,
    getTrustLeaderboard,
    getAllUsers,
    getActivityTimeline
} = require("../controllers/adminController");

/* ================= GLOBAL ADMIN GUARD ================= */
// 🔐 Apply auth once for all routes
router.use(verifyToken, verifyAdmin);

/* =====================================================
   📊 ADMIN DASHBOARD (SINGLE SOURCE OF TRUTH)
===================================================== */
router.get("/dashboard/stats", getAdminAnalytics);

/* =====================================================
   ✅ PRODUCE MANAGEMENT
===================================================== */

// Approve produce (with base price)
router.put("/produce/approve/:batchId", approveProduce);

// Reject produce (admin decision)
router.put("/produce/reject/:batchId", confirmTamper);

// Confirm transporter collection
router.put("/produce/confirm-collection/:batchId", confirmTransporterCollection);

/* =====================================================
   🧪 SYSTEM TESTING / SIMULATION
===================================================== */

// Simulate tampering attack (demo only)
router.post("/simulate-attack", simulateAttack);

/* =====================================================
   📊 ANALYTICS & USERS
===================================================== */

// Trust leaderboard
router.get("/trust-leaderboard", getTrustLeaderboard);

// Fetch all users
router.get("/all-users", getAllUsers);

// Full activity timeline
router.get("/activity-timeline", getActivityTimeline);

module.exports = router;