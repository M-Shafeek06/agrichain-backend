const express = require("express");
const router = express.Router();

const { verifyProduce, verifyAllocation } = require("../controllers/verifyController");

// ✅ FIXED ROUTES
router.get("/:batchId", verifyProduce);
router.get("/allocation/:inventoryId", verifyAllocation);

module.exports = router;