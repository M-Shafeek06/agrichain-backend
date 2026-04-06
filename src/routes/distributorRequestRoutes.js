const express = require("express");
const router = express.Router();

const {
    getIncomingRequests,
    approveRequest,
    rejectRequest   // ✅ ADD THIS
} = require("../controllers/distributorRequestController");

router.get("/requests", getIncomingRequests);
router.post("/request/:id/approve", approveRequest);

router.post("/request/:id/reject", rejectRequest);

module.exports = router;