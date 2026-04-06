const express = require("express");
const router = express.Router();

const verifyToken = require("../../middleware/verifyToken");
const produceController = require("../controllers/produceController");

/* ======================================================
CREATE PRODUCE (FARMER ONLY)
====================================================== */

router.post(
  "/create",
  verifyToken,
  produceController.createProduceBatch
);

/* ======================================================
PUBLIC VIEW (CONSUMER / QR VERIFICATION)
====================================================== */

router.get(
  "/view/:batchId",
  produceController.viewProduceReadonly
);

/* ======================================================
ADMIN ACTIONS
====================================================== */

router.put(
  "/approve/:batchId",
  verifyToken,
  produceController.approveProduce
);

router.put(
  "/reject/:batchId",
  verifyToken,
  produceController.rejectProduce
);

/* ======================================================
RETAILER FLOW
====================================================== */

router.post(
  "/request/:batchId",
  verifyToken,
  produceController.requestByRetailer
);

router.post(
  "/sell/:batchId",
  verifyToken,
  produceController.sellProduce
);

/* ======================================================
FARMER DASHBOARD (PROTECTED)
====================================================== */

router.get(
  "/recent/:farmerId",
  verifyToken,
  produceController.getRecentSubmissions
);

router.get(
  "/history/:farmerId",
  verifyToken,
  produceController.getProduceHistory
);

router.get(
  "/frequency/:farmerId",
  verifyToken,
  produceController.getSubmissionFrequency
);

/* ======================================================
TRANSPORTER INVOICE APIs
====================================================== */

router.get(
  "/invoice/transporter/:transporterId",
  verifyToken,
  produceController.getTransporterInvoices
);

/* ======================================================
PUBLIC INVOICE DOWNLOAD
(used by verification or customer view)
====================================================== */

router.get(
  "/invoice/download/:batchId",
  produceController.downloadTransporterInvoice
);

module.exports = router;