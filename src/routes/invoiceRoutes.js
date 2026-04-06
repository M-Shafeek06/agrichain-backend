const express = require("express");
const router = express.Router();
const { downloadInvoice } = require("../controllers/invoiceController");

router.get("/invoice/:batchId", downloadInvoice);

module.exports = router;
