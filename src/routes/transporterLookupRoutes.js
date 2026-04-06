const express = require("express");
const router = express.Router();
const controller = require("../controllers/transporterLookupController");

router.get("/transporters", controller.getTransporters);

module.exports = router;
