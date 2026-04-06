const express = require("express");
const router = express.Router();
const controller = require(
    "../controllers/stockRequestController"
);

/* Retailer */

router.post("/retailer/request", controller.createRequest);
router.get("/retailer/my-requests", controller.getRetailerRequests);

/* Distributor */

router.get(
    "/distributor/requests",
    controller.getDistributorRequests
);

module.exports = router;
