const express = require("express");
const router = express.Router();
const verifyToken = require("../../middleware/verifyToken");
const allowRoles = require("../../middleware/allowRoles");

/* ================= CONTROLLERS ================= */

const distributorController = require("../controllers/distributorController");
const distributorDispatchController = require("../controllers/distributorDispatchController");
const distributorInvoiceController = require("../controllers/distributorInvoiceController");

/* ================= VALIDATION CHECK ================= */

function validate(handler, name) {
    if (typeof handler !== "function") {
        throw new Error(`Route handler "${name}" is not a function`);
    }
}

/* Validate all handlers immediately */
router.get("/dashboard",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorController.getDashboard
);

router.get("/incoming",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorController.getIncomingShipments
);

router.post("/accept",
    (req, res, next) => {
        console.log("🔥 ACCEPT HIT");
        next();
    },
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorController.acceptShipment
);

router.post("/confirm-base-price",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorController.confirmBasePrice
);

router.get("/inventory",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorController.getInventory
);

router.get("/dispatch",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorDispatchController.getDispatchList
);

router.post("/dispatch/:id",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorDispatchController.dispatchToRetailer
);

router.get("/invoices",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorInvoiceController.getDistributorInvoices
);

router.get("/invoice/:invoiceId",
    verifyToken,
    allowRoles("DISTRIBUTOR", "RETAILER"),
    distributorInvoiceController.downloadDistributorInvoice
);

router.get(
    "/warehouse-history",
    verifyToken,
    allowRoles("DISTRIBUTOR"),
    distributorController.getWarehouseHistory
);


module.exports = router;
