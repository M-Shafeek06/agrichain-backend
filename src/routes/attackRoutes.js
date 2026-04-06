const express = require("express");
const router = express.Router();
const { simulateTamperAttack } = require("../controllers/attackController");

router.post("/simulate/:batchId", simulateTamperAttack);

module.exports = router;
