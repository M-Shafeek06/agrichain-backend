const express = require("express");
const router = express.Router();

const {
    getRetailerInventory,
    recordSale,
    getSalesHistory,
    getSalesAnalytics,
    getRecentSales
} = require("../controllers/inventoryController");

// ================= INVENTORY =================
router.get("/", getRetailerInventory);
router.post("/sell", recordSale);

// ================= SALES =================
router.get("/sales/history", getSalesHistory);
router.get("/sales/analytics", getSalesAnalytics);

// routes/inventoryRoutes.js

router.get("/recent-sales/:retailerId", getRecentSales);

module.exports = router;
