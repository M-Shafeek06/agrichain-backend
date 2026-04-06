const Shipment = require("../models/Shipment");
const Produce = require("../models/Produce");
const TrustScore = require("../models/TrustScore");
const RoleIdentity = require("../models/RoleIdentity");
const RetailerInventory = require("../models/RetailerInventory");

const geoCheck = require("../utils/geoCheck");
const crypto = require("crypto");
const canonicalStringify = require("../utils/canonicalStringify");
const getCoordinates = require("../utils/geoCache");
const calcDistance = require("../utils/calcDistance");

const blockchainService = require("../services/blockchainService");
const { verifyBatch } = require("./verifyController");

const { money, div } = require("../utils/money");
const updateTrustScore = require("../utils/updateTrustScore");

/* =====================================================
HASH
===================================================== */

const generateBlockHash = payload =>
  crypto
    .createHash("sha256")
    .update(canonicalStringify(payload))
    .digest("hex");

/* =====================================================
TRUST
===================================================== */

async function updateTrust({ roleId, role, entityName }, isValid) {
  try {
    // ✅ FIX: include role in query
    let record = await TrustScore.findOne({ roleId, role });

    if (!record) {
      record = new TrustScore({
        roleId,
        role,
        entityName,
        totalBlocks: 0,
        validBlocks: 0,
        trustScore: 0
      });
    }

    record.totalBlocks++;

    if (isValid) {
      record.validBlocks++;
    }

    record.trustScore = Math.round(
      (record.validBlocks / record.totalBlocks) * 100
    );

    await record.save();

  } catch (err) {
    console.warn("Trust update skipped:", err.message);
  }
}


/* =====================================================
UPDATE SHIPMENT (FINAL STABLE VERSION)
===================================================== */

const allowedTransitions = {
  IN_TRANSPORT_TO_DISTRIBUTOR: ["PICKED_UP", "IN_TRANSIT", "AT_DISTRIBUTOR"],

  OWNED_BY_DISTRIBUTOR: [
    "ASSIGNED_TO_TRANSPORTER"
  ],

  RETAILER_REQUESTED: [
    "ASSIGNED_TO_TRANSPORTER",
    "PICKED_UP"
  ],

  IN_TRANSPORT_TO_RETAILER: [
    "IN_TRANSIT",
    "DELIVERED"
  ],

  DELIVERED_TO_RETAILER: []
};

/* =====================================================
START TRANSPORT (Farmer Only - No Shipment Block)
===================================================== */

exports.startTransport = async (req, res) => {
  try {
    const { batchId, farmerId } = req.body;

    if (!batchId || !farmerId) {
      return res.status(400).json({ message: "Missing fields" });
    }

    const produce = await Produce.findOne({ batchId });


    if (!produce) {
      return res.status(404).json({ message: "Batch not found" });
    }

    if (produce.farmerId !== farmerId) {
      return res.status(403).json({ message: "Unauthorized farmer" });
    }

    if (produce.verificationStatus !== "APPROVED") {
      return res.status(400).json({
        message: "Rejected or unapproved batch cannot start transport"
      });
    }

    const transporterId = produce.transporterInvoice?.transporterId;

    if (!transporterId) {
      return res.status(400).json({
        message: "Transporter invoice missing"
      });
    }

    // 🔥 Ownership transfer to transporter
    produce.state = "IN_TRANSPORT_TO_DISTRIBUTOR";
    produce.currentOwnerRole = "TRANSPORTER";
    produce.currentOwnerId = transporterId;
    produce.transported = true;

    await produce.save();

    const payload = {
      batchId,
      handlerRole: "TRANSPORTER",
      handlerId: transporterId,
      handlerName: produce.transporterInvoice.transporterName,
      cropName: produce.cropName,
      status: "PICKED_UP",
      location: produce.transporterInvoice.fromLocation,
      previousHash: "GENESIS",
      distributorId: produce.distributorId,
      retailerId: null,
      shipmentSessionId: "SESSION-" + crypto.randomUUID().slice(0, 8),
      shipmentQuantity: produce.totalQuantity,
      transporterId,
      invoiceId: null
    };

    // 🔥 GET COORDINATES FOR PICKUP LOCATION
    const pickupCoord = await getCoordinates(
      produce.transporterInvoice.fromLocation
    );

    await Shipment.create({
      ...payload,
      blockHash: generateBlockHash(payload),
      isValid: true,
      distance: 0,
      lat: pickupCoord?.lat || null,
      lng: pickupCoord?.lng || null
    });

    return res.json({
      message: "Transport initiated successfully"
    });

  } catch (err) {
    console.error("START TRANSPORT ERROR:", err);
    res.status(500).json({ message: "Failed to start transport" });
  }
};


exports.updateShipment = async (req, res) => {
  let shipmentDoc;

  try {
    let {
      batchId,
      shipmentId,
      handlerId,
      status,
      location,
      retailerId,
      shipmentSessionId: sessionFromClient
    } = req.body;

    batchId = batchId || shipmentId;

    if (!batchId || !handlerId || !status || !location) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const roleUser = await RoleIdentity.findOne({ roleId: handlerId });

    if (!roleUser) {
      return res.status(404).json({ message: "Invalid handler" });
    }

    const handlerRole = roleUser.role.toUpperCase();
    status = status.toUpperCase().trim();
    location = location.trim();

    const produce = await Produce.findOne({ batchId });

    if (!produce) {
      return res.status(404).json({ message: "Invalid batch ID" });
    }

    if (produce.verificationStatus !== "APPROVED") {
      return res.status(400).json({
        message: "Rejected batch cannot be processed in shipment"
      });
    }

    /* =====================================================
   🔐 OWNERSHIP VALIDATION (ROLE-AWARE)
===================================================== */

    if (handlerRole !== "TRANSPORTER") {
      // For farmer / distributor / retailer → strict ownership
      if (produce.currentOwnerId !== handlerId) {
        return res.status(403).json({
          message: "Unauthorized: You are not the current owner of this batch"
        });
      }
    }

    /* ================= INVOICE LOCATION VALIDATION ================= */

    if (handlerRole === "TRANSPORTER") {

      const invoice = produce.transporterInvoice;

      if (!invoice) {
        return res.status(400).json({
          message: "Transport invoice missing"
        });
      }

      /* ========= SESSION 1 : FARMER → DISTRIBUTOR ========= */

      // Pickup from farmer
      if (
        status === "PICKED_UP" &&
        produce.state === "IN_TRANSPORT_TO_DISTRIBUTOR"
      ) {
        if (location !== invoice.fromLocation) {
          return res.status(400).json({
            message: `Pickup must be from ${invoice.fromLocation}`
          });
        }
      }

      // Delivery to distributor
      if (
        status === "AT_DISTRIBUTOR" &&
        produce.state === "IN_TRANSPORT_TO_DISTRIBUTOR"
      ) {
        if (location !== invoice.toLocation) {
          return res.status(400).json({
            message: `Delivery must be to ${invoice.toLocation}`
          });
        }
      }


      /* ========= SESSION 2 : DISTRIBUTOR → RETAILER ========= */

      // Pickup from distributor
      if (
        status === "PICKED_UP" &&
        produce.state === "RETAILER_REQUESTED"
      ) {
        if (location !== invoice.toLocation) {
          return res.status(400).json({
            message: `Pickup must be from distributor location ${invoice.toLocation}`
          });
        }
      }

      // Delivery to retailer
      if (
        status === "DELIVERED"
      ) {

        const retailer = await RoleIdentity.findOne({
          roleId: produce.requestedRetailerId
        }).lean();

        const retailerLocation = retailer?.location;

        if (!retailerLocation) {
          return res.status(400).json({
            message: "Retailer location not found"
          });
        }

        if (location !== retailerLocation) {
          return res.status(400).json({
            message: `Delivery must be to retailer location ${retailerLocation}`
          });
        }
      }

    }

    /* ================= PICKUP STATE VALIDATION ================= */

    if (status === "PICKED_UP") {

      // Transporter picking from farmer
      if (produce.state === "IN_TRANSPORT_TO_DISTRIBUTOR") {
        if (handlerRole !== "TRANSPORTER") {
          return res.status(403).json({
            message: "Only transporter can pick up from farmer"
          });
        }
      }

      // Transporter picking for retailer delivery
      if (produce.state === "RETAILER_REQUESTED") {
        if (handlerRole !== "TRANSPORTER") {
          return res.status(403).json({
            message: "Only transporter can pick up retailer shipment"
          });
        }
      }
    }

    /* ================= STATE TRANSITION GUARD ================= */

    if (!allowedTransitions[produce.state]) {
      return res.status(400).json({
        message: "Invalid batch state"
      });
    }

    if (!allowedTransitions[produce.state].includes(status)) {
      return res.status(400).json({
        message: `Invalid state transition from ${produce.state} to ${status}`
      });
    }

    /* ================= LAST BLOCK ================= */

    // 🔥 FIRST define session ID
    const lastBlockGlobal = await Shipment.findOne({ batchId })
      .sort({ createdAt: -1 })
      .lean();

    const shipmentSessionId =
      sessionFromClient ||
      lastBlockGlobal?.shipmentSessionId ||
      "SESSION-" + crypto.randomUUID().slice(0, 8);

    // 🔥 NOW use it safely
    const lastBlock = await Shipment.findOne({
      batchId,
      shipmentSessionId
    })
      .sort({ createdAt: -1 })
      .lean();

    /* ================= STRICT OWNERSHIP + SESSION SECURITY ================= */


    // 2️⃣ If session already exists → it must belong to same handler
    const lastSessionBlock = await Shipment.findOne({
      batchId,
      shipmentSessionId
    })
      .sort({ createdAt: -1 })
      .lean();

    if (lastSessionBlock) {

      const isTransporterSession =
        lastSessionBlock.transporterId === handlerId;

      if (!isTransporterSession) {
        return res.status(403).json({
          message: "Unauthorized: Session belongs to another transporter"
        });
      }
    }

    /* ================= STRICT FLOW ENFORCEMENT ================= */

    const isFirstBlock = !lastSessionBlock;

    let statusOrder;

    // Farmer → Distributor shipment
    if (produce.state === "IN_TRANSPORT_TO_DISTRIBUTOR") {

      statusOrder = [
        "PICKED_UP",
        "IN_TRANSIT",
        "AT_DISTRIBUTOR"
      ];

    }

    // Distributor → Retailer shipment
    else if (
      produce.state === "RETAILER_REQUESTED" ||
      produce.state === "IN_TRANSPORT_TO_RETAILER"
    ) {

      statusOrder = [
        "ASSIGNED_TO_TRANSPORTER",
        "PICKED_UP",
        "IN_TRANSIT",
        "DELIVERED"
      ];

    }

    else {
      return res.status(400).json({
        message: "Invalid batch state for shipment update"
      });
    }
    /* ========= FIRST SHIPMENT BLOCK ========= */

    if (isFirstBlock) {

      if (
        status !== "PICKED_UP" &&
        status !== "ASSIGNED_TO_TRANSPORTER"
      ) {
        return res.status(400).json({
          message: "First transport update must be PICKED_UP"
        });
      }

    } else {

      /* ========= SMART REPLAY PROTECTION ========= */

      const isExactDuplicate =
        lastSessionBlock.status === status &&
        lastSessionBlock.location === location;

      if (isExactDuplicate) {
        return res.status(400).json({
          message: "Replay detected: identical status and location"
        });
      }

      const lastIndex = statusOrder.indexOf(lastSessionBlock.status);
      const newIndex = statusOrder.indexOf(status);

      if (lastIndex === -1 || newIndex === -1) {
        return res.status(400).json({
          message: "Invalid transport status"
        });
      }

      /* ========= SEQUENTIAL PROGRESSION WITH TRANSIT LOOP ========= */
      if (
        lastSessionBlock.status === "IN_TRANSIT" &&
        status === "IN_TRANSIT"
      ) {
        // allow looping transit updates
      } else {
        if (newIndex !== lastIndex + 1) {
          return res.status(400).json({
            message: `Invalid progression. Expected ${statusOrder[lastIndex + 1]
              } after ${lastSessionBlock.status}`
          });
        }
      }
    }

    /* ========= EXTRA STATE-SPECIFIC SAFETY ========= */

    // Allow delivery only if a retailer request exists
    if (status === "DELIVERED" && !produce.requestedRetailerId) {
      return res.status(400).json({
        message: "Retailer delivery not assigned"
      });
    }

    // AT_DISTRIBUTOR only allowed in farmer → distributor flow
    if (
      status === "AT_DISTRIBUTOR" &&
      produce.state !== "IN_TRANSPORT_TO_DISTRIBUTOR"
    ) {
      return res.status(400).json({
        message: "AT_DISTRIBUTOR only allowed for distributor shipment"
      });
    }

    /* ================= GEO ================= */

    const prevHash = lastBlock?.blockHash || "GENESIS";
    const currCoord = await getCoordinates(location);

    let isValid = true;
    let distance = 0;

    if (
      lastBlock &&
      currCoord?.lat != null &&
      lastBlock.lat != null
    ) {
      distance = calcDistance(
        lastBlock.lat,
        lastBlock.lng,
        currCoord.lat,
        currCoord.lng
      );

      isValid =
        distance <= 1000 &&
        geoCheck(
          { lat: lastBlock.lat, lng: lastBlock.lng },
          { lat: currCoord.lat, lng: currCoord.lng }
        );
    }

    /* ================= OWNERSHIP IDs ================= */

    let distributorId =
      lastBlock?.distributorId || produce.distributorId || null;

    let finalRetailerId =
      retailerId ||
      lastBlock?.retailerId ||
      produce.requestedRetailerId ||
      null;

    /* ================= SHIPMENT QUANTITY ================= */

    let shipmentQty;

    // 🔥 NEW SESSION (retailer flow)
    if (!lastSessionBlock && produce.state === "RETAILER_REQUESTED") {
      const RetailerRequest = require("../models/RetailerRequest");

      const request = await RetailerRequest.findOne({
        batchId,
        retailerId: produce.requestedRetailerId,
        status: { $in: ["APPROVED", "DISPATCHED"] }
      });

      shipmentQty = request?.requestedQty || 0;
    }

    // 🔥 EXISTING SESSION
    else {
      shipmentQty = lastSessionBlock?.shipmentQuantity || produce.totalQuantity;
    }

    if (status === "ASSIGNED_TO_TRANSPORTER") {

      // 🔐 Only distributor can assign transporter
      if (handlerRole !== "DISTRIBUTOR") {
        return res.status(403).json({
          message: "Only distributor can assign transporter"
        });
      }

      const RetailerRequest = require("../models/RetailerRequest");

      const request = await RetailerRequest.findOne({
        batchId,
        retailerId: finalRetailerId,
        status: "APPROVED"
      });

      if (!request) {
        return res.status(400).json({
          message: "Retailer request not approved"
        });
      }

      if (produce.remainingQuantity < request.requestedQty) {
        return res.status(400).json({
          message: "Insufficient quantity available"
        });
      }

      shipmentQty = request.requestedQty;

      /* 🔥 SINGLE DEDUCTION POINT */
      produce.remainingQuantity -= request.requestedQty;
      produce.reservedQuantity += request.requestedQty;

      /* 🔥 ADD PROFIT CALCULATION */
      const basePrice = produce.basePrice || 0;
      const qty = request.requestedQty;

      const profit = Math.round(qty * basePrice * 0.15);

      // accumulate profit
      produce.distributorProfit = (produce.distributorProfit || 0) + profit;

      request.status = "DISPATCHED";
      await request.save();

      /* 🔄 Ownership remains distributor until pickup */
      produce.state = "RETAILER_REQUESTED";
      produce.currentOwnerRole = "DISTRIBUTOR";
      produce.currentOwnerId = produce.distributorId;
    }
    /* ================= CREATE BLOCK ================= */

    const payload = {
      batchId: String(batchId || "").trim(),
      handlerRole: String(handlerRole || "").trim(),
      handlerId: String(handlerId || "").trim(),
      handlerName: String(roleUser.name || "").trim(),
      cropName: String(produce.cropName || "").trim(),

      status: String(status || "").trim(),
      location: String(location || "").trim(),

      previousHash: String(prevHash || "GENESIS"),

      distributorId: distributorId
        ? String(distributorId).trim()
        : null,

      retailerId: finalRetailerId
        ? String(finalRetailerId).trim()
        : null,

      shipmentSessionId: shipmentSessionId
        ? String(shipmentSessionId).trim()
        : null,

      shipmentQuantity: Number(shipmentQty || 0),

      transporterId:
        handlerRole === "TRANSPORTER"
          ? String(handlerId).trim()
          : (lastBlock?.transporterId
            ? String(lastBlock.transporterId).trim()
            : null),

      invoiceId:
        lastBlock?.invoiceId ||
        (status === "ASSIGNED_TO_TRANSPORTER"
          ? "INV-" + crypto.randomUUID().slice(0, 6)
          : null)

    };

    shipmentDoc = await Shipment.create({
      ...payload,
      blockHash: generateBlockHash(payload),
      isValid,
      distance: Number(distance.toFixed(2)),
      lat: currCoord?.lat || null,
      lng: currCoord?.lng || null
    });

    produce.shipmentCount = (produce.shipmentCount || 0) + 1;

    /* ================= STATE MACHINE ================= */

    // SESSION 1 : Farmer → Distributor pickup
    if (
      status === "PICKED_UP" &&
      produce.state === "IN_TRANSPORT_TO_DISTRIBUTOR"
    ) {
      produce.currentOwnerRole = "TRANSPORTER";
      produce.currentOwnerId = handlerId;
    }

    // ✅ ADD THIS BLOCK HERE (IMPORTANT)
    if (
      status === "AT_DISTRIBUTOR" &&
      produce.state === "IN_TRANSPORT_TO_DISTRIBUTOR"
    ) {
      // Mark arrival ONLY (no ownership change yet)
      produce.arrivedAtDistributor = true;

      // Still transporter owns until distributor confirms
      produce.currentOwnerRole = "TRANSPORTER";
      produce.currentOwnerId = handlerId;
    }


    // SESSION 2 : Distributor → Retailer pickup
    if (
      status === "PICKED_UP" &&
      produce.state === "RETAILER_REQUESTED"
    ) {
      produce.state = "IN_TRANSPORT_TO_RETAILER";

      produce.currentOwnerRole = "TRANSPORTER";
      produce.currentOwnerId = handlerId;

      /* 🔥 CRITICAL FIX: MOVE RESERVED → IN TRANSIT */
      const qty = shipmentQty;

      // 🔥 HANDLE BOTH CASES (clean + already-shifted data)
      if (produce.reservedQuantity >= qty) {
        // NORMAL FLOW
        produce.reservedQuantity -= qty;
        produce.inTransitQuantity += qty;
      } else if (produce.inTransitQuantity >= qty) {
        // 🔥 FALLBACK: already moved earlier → allow pickup
        console.warn("⚠️ Quantity already in transit, skipping move");
      } else {
        return res.status(400).json({
          message: "Reserved quantity mismatch"
        });
      }
    }

    // Retailer delivery completed
    if (status === "DELIVERED") {

      if (handlerRole !== "TRANSPORTER") {
        return res.status(403).json({
          message: "Only transporter can mark delivery"
        });
      }

      const RetailerRequest = require("../models/RetailerRequest");

      const retailerRequest = await RetailerRequest.findOne({
        batchId,
        retailerId: finalRetailerId,
        status: "DISPATCHED"
      });

      if (!retailerRequest) {
        throw new Error("Retailer request not found or not dispatched");
      }

      /* ================= UPDATE REQUEST ================= */

      retailerRequest.status = "DELIVERED";
      await retailerRequest.save();

      /* ================= STATE UPDATE ================= */

      produce.state = "DELIVERED_TO_RETAILER";

      produce.currentOwnerRole = "TRANSPORTER";
      produce.currentOwnerId = handlerId; // transporter
    }

    await produce.save();

    // 🔥 AUTO VERIFY AFTER SHIPMENT UPDATE
    const verificationResult = await verifyBatch(batchId);

    if (
      (verificationResult.status === "TAMPERED" ||
        verificationResult.invalidBlocks > 0 ||
        verificationResult.tamperRisk === "HIGH") &&
      produce.integrityStatus !== "TAMPERED" // 🔥 ADD THIS
    ) {

      // 🔥 GET CURRENT OWNER (REAL RESPONSIBLE PERSON)
      const responsibleRole = produce.currentOwnerRole;
      const responsibleId = produce.currentOwnerId;

      const responsibleUser = await RoleIdentity.findOne({
        roleId: responsibleId
      });

      // 🔥 PENALIZE ONLY RESPONSIBLE ROLE
      await updateTrustScore({
        role: responsibleRole,
        roleId: responsibleId,
        entityName: responsibleUser?.name || responsibleRole,
        isValid: false,
        batchId,
        reason: "Blockchain hash mismatch detected"
      });

      await Produce.updateOne(
        { batchId },
        {
          $set: {
            integrityStatus: "TAMPERED",
            integrityScore: 0,
            verificationStatus: "INVALIDATED",
            verifiedBy: "SYSTEM",
            verifiedAt: new Date(),
            tamperExplanation: verificationResult.explanation
          }
        }
      );

      await Shipment.updateMany(
        { batchId },
        { $set: { chainValid: false } }
      );
    }

    // Only reward valid actions (optional)
    if (isValid) {
      await updateTrustScore({
        role: handlerRole,
        roleId: handlerId,
        entityName: roleUser.name,
        isValid: true,
        batchId,
        reason: "Valid shipment update"
      });
    }

    res.json({
      message: "Shipment updated successfully",
      blockId: shipmentDoc._id
    });
  } catch (err) {
    console.error("SHIPMENT ERROR:", err);

    res.status(500).json({
      message: "Shipment update failed"
    });
  }
};

exports.getTransporterShipments = async (req, res) => {
  try {
    const { transporterId } = req.params;
    if (!transporterId) return res.json([]);

    const shipments = await Shipment.aggregate([

      /* 🔥 SESSION 2 BELONGING TO THIS TRANSPORTER */
      {
        $match: {
          transporterId: transporterId,
          retailerId: { $ne: null }   // Session 2 only
        }
      },

      { $sort: { createdAt: -1 } },

      {
        $group: {
          _id: "$shipmentSessionId",
          latestBlock: { $first: "$$ROOT" }
        }
      },

      { $replaceRoot: { newRoot: "$latestBlock" } },

      {
        $match: {
          status: {
            $in: [
              "ASSIGNED_TO_TRANSPORTER",
              "PICKED_UP",
              "IN_TRANSIT"
            ]
          }
        }
      },

      { $sort: { createdAt: -1 } }

    ]);

    res.json(shipments);

  } catch (err) {
    console.error("Transporter shipment fetch error:", err);
    res.status(500).json({
      message: "Failed to fetch shipments"
    });
  }
};

/* =====================================================
HISTORY
===================================================== */

exports.getTransportHistory = async (req, res) => {
  try {
    const logs = await Shipment.find({
      handlerRole: "TRANSPORTER",
      handlerId: req.params.transporterId
    }).sort({ createdAt: 1 });

    res.json(logs);
  } catch {
    res.status(500).json({ message: "History fetch failed" });
  }
};


exports.getRetailerHistory = async (req, res) => {
  try {
    const { id } = req.params;

    console.log("Retailer ID:", id);

    const allShipments = await Shipment.find();
    console.log("Total Shipments In DB:", allShipments.length);

    const shipments = await Shipment.find({ retailerId: id });
    console.log("Matching Shipments:", shipments.length);

    res.json(shipments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to fetch history" });
  }
};



/* =====================================================
   TRANSPORTER – RECENT UPDATES (FLAT STRUCTURE)
   Used by TransporterUpdate page
===================================================== */

exports.getTransporterRecent = async (req, res) => {
  try {
    const { transporterId } = req.params;

    if (!transporterId) {
      return res.json([]);
    }

    const shipments = await Shipment.aggregate([
      {
        $match: {
          handlerRole: "TRANSPORTER",
          handlerId: transporterId
        }
      },

      { $sort: { createdAt: -1 } },

      {
        $group: {
          _id: { $ifNull: ["$shipmentSessionId", "$batchId"] },
          latestBlock: { $first: "$$ROOT" }
        }
      },

      { $replaceRoot: { newRoot: "$latestBlock" } },

      { $sort: { createdAt: -1 } },

      { $limit: 3 }
    ]);

    res.json(shipments);

  } catch (err) {
    console.error("Recent shipment fetch error:", err);
    res.status(500).json({
      message: "Failed to fetch recent shipments"
    });
  }
};

exports.getTransporterLiveRoutes = async (req, res) => {
  try {
    const { transporterId } = req.params;

    if (!transporterId) {
      return res.json([]);
    }

    const routes = await Shipment.aggregate([
      /* ================= MATCH TRANSPORTER ================= */
      {
        $match: {
          handlerRole: "TRANSPORTER",
          handlerId: transporterId
        }
      },

      /* ================= SORT NEWEST FIRST ================= */
      { $sort: { createdAt: -1 } },

      /* ================= GROUP BY SESSION ================= */
      {
        $group: {
          _id: {
            $ifNull: ["$shipmentSessionId", "$batchId"]
          },
          latestBlock: { $first: "$$ROOT" }
        }
      },

      /* ================= FLATTEN ================= */
      { $replaceRoot: { newRoot: "$latestBlock" } },

      /* ================= SELECT FIELDS FOR FRONTEND ================= */
      {
        $project: {
          _id: 1,
          batchId: 1,
          cropName: 1,
          location: 1,
          status: 1,
          shipmentSessionId: 1,
          shipmentQuantity: 1,
          createdAt: 1,
          distributorId: 1,
          retailerId: 1
        }
      },

      /* ================= FINAL SORT ================= */
      { $sort: { createdAt: -1 } }
    ]);

    return res.json(routes);

  } catch (err) {
    console.error("Live routes error:", err);
    return res.status(500).json({
      message: "Failed to fetch live routes"
    });
  }
};

exports.acceptAtDistributor = async (req, res) => {
  try {
    const distributorId = req.headers["x-role-id"];
    const { shipmentId } = req.params; // this is actually Produce._id

    if (!distributorId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const produce = await Produce.findById(shipmentId);

    if (!produce) {
      return res.status(404).json({ message: "Batch not found" });
    }

    if (produce.verificationStatus !== "APPROVED") {
      return res.status(400).json({
        message: "Rejected batch cannot be accepted"
      });
    }

    if (produce.distributorId !== distributorId) {
      return res.status(403).json({
        message: "Not authorized for this batch"
      });
    }

    if (
      produce.state !== "IN_TRANSPORT_TO_DISTRIBUTOR" &&
      produce.state !== "AT_DISTRIBUTOR"
    ) {
      return res.status(400).json({
        message: "Batch is not awaiting distributor confirmation"
      });
    }

    // AUTO REJECT IF TAMPERED
    if (produce.integrityStatus === "TAMPERED") {

      const distributor = await RoleIdentity.findOne({ roleId: distributorId });

      await updateTrust({
        roleId: distributorId,
        role: "DISTRIBUTOR",
        entityName: distributor?.name || "Distributor"
      }, false);

      // record rejection in shipment chain
      await Shipment.create({
        batchId: produce.batchId,
        handlerRole: "DISTRIBUTOR",
        handlerId: distributorId,
        handlerName: "Distributor",
        cropName: produce.cropName,
        status: "REJECTED_BY_DISTRIBUTOR",
        location: produce.transporterInvoice?.toLocation || "Distributor",
        previousHash: "GENESIS",
        distributorId: distributorId,
        shipmentQuantity: produce.totalQuantity,
        blockHash: "REJECTED-" + Date.now(),
        isValid: false
      });

      return res.status(400).json({
        message: "Shipment rejected automatically due to tampering"
      });


    }

    if (!produce.distributorAcceptedBasePrice) {
      return res.status(400).json({
        message: "Confirm base price before accepting shipment"
      });
    }

    if (!produce.transporterInvoice?.charge) {
      return res.status(400).json({
        message: "Transport charge missing"
      });
    }

    const quantity = produce.remainingQuantity || produce.totalQuantity;
    const basePrice = produce.basePrice;
    const transportCharge = produce.transporterInvoice.charge;

    const goodsCost = quantity * basePrice;
    const totalCost = Math.round((goodsCost + transportCharge) * 100) / 100;

    produce.initialTransportCost = transportCharge;
    produce.distributorTotalCost = totalCost;

    produce.costLocked = true;

    /* ================= OWNERSHIP TRANSFER ================= */

    produce.state = "OWNED_BY_DISTRIBUTOR";
    produce.currentOwnerRole = "DISTRIBUTOR";
    produce.currentOwnerId = distributorId;
    produce.distributorAcceptedAt = new Date();

    const distributor = await RoleIdentity.findOne({ roleId: distributorId });

    await updateTrust({
      roleId: distributorId,
      role: "DISTRIBUTOR",
      entityName: distributor?.name || "Distributor"
    }, true);

    await produce.save();

    return res.json({
      message: "Shipment confirmed successfully"
    });

  } catch (err) {
    console.error("Distributor accept error:", err);
    res.status(500).json({
      message: "Confirmation failed"
    });
  }
};

exports.confirmRetailerDelivery = async (req, res) => {
  try {

    const retailerId = req.headers["x-role-id"];
    const { shipmentId } = req.params; // this is actually batchId

    if (!retailerId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    /* =====================================================
       FIND DELIVERED SHIPMENT FOR THIS RETAILER
    ===================================================== */

    const shipment = await Shipment.findOne({
      batchId: shipmentId,
      retailerId: retailerId,
      status: "DELIVERED"
    }).sort({ createdAt: -1 });

    if (!shipment) {
      return res.status(404).json({
        message: "Delivered shipment not found"
      });
    }

    /* =====================================================
       FETCH PRODUCE
    ===================================================== */

    const produce = await Produce.findOne({
      batchId: shipment.batchId
    });

    if (produce.integrityStatus === "TAMPERED") {
      return res.status(403).json({
        message: "Tampered product cannot be confirmed"
      });
    }

    if (produce.verificationStatus !== "APPROVED") {
      return res.status(400).json({
        message: "Rejected batch cannot be delivered"
      });
    }

    if (!produce) {
      return res.status(404).json({ message: "Batch not found" });
    }

    /* =====================================================
       VALIDATE STATE
    ===================================================== */

    if (produce.state !== "DELIVERED_TO_RETAILER") {
      return res.status(400).json({
        message: "Shipment not awaiting retailer confirmation"
      });
    }

    /* =====================================================
       VALIDATE RETAILER OWNERSHIP
    ===================================================== */

    if (produce.requestedRetailerId !== retailerId) {
      return res.status(403).json({
        message: "Not authorized for this shipment"
      });
    }

    const shipmentQty = shipment.shipmentQuantity;

    /* ================= BLOCKCHAIN OWNERSHIP ================= */

    await blockchainService.storeOwnershipTransferOnBlockchain(
      produce.batchId,
      produce.distributorId,
      retailerId
    );

    /* ================= PRICE ENGINE ================= */

    const distributorUnitCost = div(
      produce.distributorTotalCost,
      produce.totalQuantity
    );
    const dispatchCost = Number(
      (distributorUnitCost * shipmentQty).toFixed(2)
    );

    const Invoice = require("../models/Invoice");

    const invoice = await Invoice.findOne({
      batchId: shipment.batchId,
      retailerId: retailerId
    }).sort({ createdAt: -1 });

    if (!invoice) {
      throw new Error("Transport invoice missing");
    }

    const transportCharge = money(invoice.charge);

    const DISTRIBUTOR_MARGIN = 0.15;
    const productTotal = dispatchCost * (1 + DISTRIBUTOR_MARGIN);

    const bulkTotalPrice = productTotal + transportCharge;
    const retailerPerKgPrice = div(bulkTotalPrice, shipmentQty);

    const productPricePerKg = div(productTotal, shipmentQty);

    const transportPerKg = div(transportCharge, shipmentQty);
    /* ================= BLOCKCHAIN ALLOCATION ================= */

    const allocation =
      await blockchainService.storeRetailAllocationOnBlockchain(
        produce.batchId,
        retailerId,
        shipmentQty
      );

    const existingInventory = await RetailerInventory.findOne({
      invoiceId: invoice.invoiceId
    });

    if (existingInventory) {
      return res.status(400).json({
        message: "Inventory already created for this shipment"
      });
    }


    function generateAllocationHash(inventory) {
      const normalized = {
        batchId: String(inventory.batchId || "").trim(),
        retailerId: String(inventory.retailerId || "").trim(),
        quantity: Number(inventory.quantity || 0),
        allocationTimestamp: Number(inventory.allocationTimestamp || 0),
        retailerPerKgPrice: money(inventory.retailerPerKgPrice || 0)
      };

      const rawData = `${normalized.batchId}-${normalized.retailerId}-${normalized.quantity}-${normalized.allocationTimestamp}-${normalized.retailerPerKgPrice}`;

      return require("crypto")
        .createHash("sha256")
        .update(rawData)
        .digest("hex");
    }

    /* ================= CREATE INVENTORY ================= */

    const allocationTimestamp = allocation.timestamp;

    const tempInventory = {
      batchId: produce.batchId,
      retailerId,
      quantity: shipmentQty,
      allocationTimestamp,
      retailerPerKgPrice
    };

    const allocationHash = generateAllocationHash(tempInventory);

    const inventory = await RetailerInventory.create({
      inventoryId: "INV-" + crypto.randomUUID().slice(0, 8),
      retailerId,
      batchId: produce.batchId,
      invoiceId: invoice.invoiceId,
      quantity: shipmentQty,
      remainingQuantity: shipmentQty,
      soldQuantity: 0,
      dispatchCost,
      transportCharge,
      bulkMultiplier: 1 + DISTRIBUTOR_MARGIN,
      bulkTotalPrice,
      retailerPerKgPrice,
      productPricePerKg,
      transportPerKg,
      allocationHash: allocationHash,
      allocationTimestamp,
      sourceShipment: shipment._id,
      status: "available"
    });

    const { generateAllocationQR } =
      require("../utils/qrGenerator");

    inventory.allocationQR =
      await generateAllocationQR(inventory.inventoryId);

    await inventory.save();

    const RetailerRequest = require("../models/RetailerRequest");

    // 🔥 MARK REQUEST AS RECORDED (PERMANENT FIX)
    await RetailerRequest.updateMany(
      {
        batchId: produce.batchId,
        retailerId: retailerId,
        status: "DELIVERED"
      },
      {
        $set: { recorded: true }
      }
    );

    /* ================= FINAL OWNERSHIP ================= */

    produce.state = "OWNED_BY_DISTRIBUTOR";
    produce.currentOwnerRole = "DISTRIBUTOR";
    produce.currentOwnerId = produce.distributorId;

    produce.soldQuantity += shipmentQty;
    produce.inTransitQuantity -= shipmentQty;

    if (produce.inTransitQuantity < 0) {
      produce.inTransitQuantity = 0;
    }

    // safety (avoid negative just in case)
    if (produce.inTransitQuantity < 0) {
      produce.inTransitQuantity = 0;
    }

    await produce.save();

    res.json({
      message: "Retailer confirmed delivery successfully"
    });

  } catch (err) {

    console.error("Retailer confirm error:", err);

    res.status(500).json({
      message: "Retailer confirmation failed"
    });
  }
};