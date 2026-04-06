const express = require("express");
const router = express.Router();

const {
    getProfile,
    updateProfile
} = require("../controllers/profileController");

const {
    getRetailerStats,
    getRetailerSupportInfo
} = require("../controllers/retailerController");

router.get("/retailer/support-info", getRetailerSupportInfo);
router.get("/retailer/stats/:id", getRetailerStats);
router.get("/:roleId", getProfile);
router.put("/:roleId", updateProfile);

module.exports = router;
