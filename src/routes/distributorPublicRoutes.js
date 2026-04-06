const express = require("express");
const router = express.Router();
const controller = require("../controllers/distributorPublicController");

router.get("/list", controller.getDistributorList);

module.exports = router;
