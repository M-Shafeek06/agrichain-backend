const express = require("express");
const router = express.Router();
const { getMarketplace } = require("../controllers/marketplaceController");

router.get("/", getMarketplace);

module.exports = router;
