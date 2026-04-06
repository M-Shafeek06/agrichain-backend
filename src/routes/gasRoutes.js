const express = require("express");
const router = express.Router();
const gasController = require("../controllers/gasController");

router.get("/stats", gasController.getGasStats);

module.exports = router;
