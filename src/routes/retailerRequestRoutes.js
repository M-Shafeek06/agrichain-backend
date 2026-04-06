const express = require("express");
const router = express.Router();

const controller = require(
    "../controllers/retailerRequestController"
);

/* Retailer */

router.post("/retailer/request", controller.createRequest);
router.get("/retailer/my-requests", controller.getMyRequests);

/* Distributor */

router.get(
    "/distributor/requests",
    controller.getDistributorRequests
);

router.post(
    "/distributor/requests/:id",
    controller.updateRequestStatus
);

module.exports = router;
