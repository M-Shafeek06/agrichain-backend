const express = require("express");
const router = express.Router();

const { getAverageIntegrity } = require("../controllers/integrityController");

router.get("/average-integrity", getAverageIntegrity);

module.exports = router;
