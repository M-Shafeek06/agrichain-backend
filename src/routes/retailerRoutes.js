const express = require("express");
const router = express.Router();

const verifyToken = require("../../middleware/verifyToken");
const allowRoles = require("../../middleware/allowRoles");

const retailerController = require("../controllers/retailerController");
const retailerAnalyticsController = require("../controllers/retailerAnalyticsController");

const { getRetailerSupportInfo } = require("../controllers/retailerController");

const {
    getRetailers,
    getRetailerStats,
    getRetailerHistory
} = retailerController;


/* ======================================================
   🔐 GET RETAILER LIST (RETAILER ONLY)
====================================================== */

router.get(
    "/list",
    verifyToken,
    allowRoles("RETAILER"),
    getRetailers
);


/* ======================================================
   🔐 GET RETAILER STATS
   Prevent ID tampering
====================================================== */

router.get(
    "/stats/:id",
    verifyToken,
    allowRoles("RETAILER"),
    (req, res, next) => {

        if (req.user.roleId !== req.params.id) {
            return res.status(403).json({
                message: "Access denied. You can only access your own stats"
            });
        }

        next();
    },
    getRetailerStats
);


/* ======================================================
   🔐 GET RETAILER HISTORY
   Prevent ID tampering
====================================================== */

router.get(
    "/history/:id",
    verifyToken,
    allowRoles("RETAILER"),
    (req, res, next) => {

        if (req.user.roleId !== req.params.id) {
            return res.status(403).json({
                message: "Access denied. You can only access your own history"
            });
        }

        next();
    },
    getRetailerHistory
);


/* ======================================================
   🔐 ADVANCED ANALYTICS
   Prevent ID tampering
====================================================== */

router.get(
    "/advanced-stats/:id",
    verifyToken,
    allowRoles("RETAILER"),
    (req, res, next) => {

        if (req.user.roleId !== req.params.id) {
            return res.status(403).json({
                message: "Access denied"
            });
        }

        next();
    },
    retailerAnalyticsController.getRetailerAdvancedStats
);


/* ======================================================
   📢 SUPPORT INFO (Public Route)
====================================================== */

router.get("/support-info", getRetailerSupportInfo);


/* ======================================================
   🔐 SELL PRODUCE
====================================================== */

router.post(
    "/sell/:batchId",
    verifyToken,
    allowRoles("RETAILER"),
    retailerController.sellProduce
);


module.exports = router;