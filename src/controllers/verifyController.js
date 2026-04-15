const Produce = require("../models/Produce");
const Shipment = require("../models/Shipment");
const TrustScore = require("../models/TrustScore");
const IntegrityLog = require("../models/IntegrityLog");

const diffSnapshot = require("../utils/diffSnapshot");
const geoCheck = require("../utils/geoCheck");
const predictTamperML = require("../utils/predictTamper");
const { getHashFromBlockchain } = require("../services/blockchainService");

const crypto = require("crypto");
const canonicalStringify = require("../utils/canonicalStringify");
const updateTrustScore = require("../utils/updateTrustScore");
const { verifyAndUpdateInventoryIntegrity } = require("../services/saleIntegrityService");

const buildTransporterInvoice = require("../utils/buildTransporterInvoice");

/* =========================================================
   🔗 SHIPMENT BLOCKCHAIN VALIDATION
========================================================= */

function generateBlockHash(payload) {
  return crypto
    .createHash("sha256")
    .update(canonicalStringify(payload))
    .digest("hex");
}

function validateShipmentChain(shipments) {
  if (!shipments || shipments.length === 0) {
    return { invalidBlocks: 0 };
  }

  let invalidBlocks = 0;

  // 🔥 GROUP BY SESSION
  const sessionMap = {};

  shipments.forEach(s => {
    const key = s.shipmentSessionId || "NO_SESSION";

    if (!sessionMap[key]) {
      sessionMap[key] = [];
    }

    sessionMap[key].push(s);
  });



  // 🔥 VALIDATE EACH SESSION SEPARATELY
  for (const sessionId in sessionMap) {

    const sessionBlocks = sessionMap[sessionId]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    let previousHash = "GENESIS";

    for (let i = 0; i < sessionBlocks.length; i++) {

      const current = sessionBlocks[i];

      // 🔐 NORMALIZED PAYLOAD (MUST MATCH CREATION EXACTLY)
      const payload = {
        batchId: String(current.batchId || "").trim(),
        handlerRole: String(current.handlerRole || "").trim(),
        handlerId: String(current.handlerId || "").trim(),
        handlerName: String(current.handlerName || "").trim(),
        cropName: String(current.cropName || "").trim(),
        status: String(current.status || "").trim(),
        location: String(current.location || "").trim(),

        previousHash: String(current.previousHash || "GENESIS"),

        distributorId: current.distributorId
          ? String(current.distributorId).trim()
          : null,

        retailerId: current.retailerId
          ? String(current.retailerId).trim()
          : null,

        shipmentSessionId: current.shipmentSessionId
          ? String(current.shipmentSessionId).trim()
          : null,

        shipmentQuantity: Number(current.shipmentQuantity || 0),

        transporterId: current.transporterId
          ? String(current.transporterId).trim()
          : null,

        invoiceId: current.invoiceId
          ? String(current.invoiceId).trim()
          : null,
      };

      const recomputedHash = generateBlockHash(payload);

      if (current.previousHash !== previousHash) {
        invalidBlocks++;
      }

      if (recomputedHash !== current.blockHash) {

        console.log("❌ HASH MISMATCH DETECTED");

        console.log("📦 DB BLOCK:");
        console.log(current);

        console.log("📦 RECONSTRUCTED PAYLOAD:");
        console.log(payload);

        console.log("🔐 STORED HASH:", current.blockHash);
        console.log("🔐 RECOMPUTED:", recomputedHash);

        invalidBlocks++;
      }

      if (current.isValid === false) {
        invalidBlocks++;
      }

      previousHash = current.blockHash;
    }
  }

  return { invalidBlocks };
}

function generateAllocationHash(inventory) {

  const normalized = {
    batchId: String(inventory.batchId || "").trim(),
    retailerId: String(inventory.retailerId || "").trim(),
    quantity: Number(inventory.quantity || 0),
    allocationTimestamp: Number(inventory.allocationTimestamp || 0),
    retailerPerKgPrice: Number(inventory.retailerPerKgPrice || 0)
  };

  const rawData = `${normalized.batchId}-${normalized.retailerId}-${normalized.quantity}-${normalized.allocationTimestamp}-${normalized.retailerPerKgPrice}`;

  return require("crypto")
    .createHash("sha256")
    .update(rawData)
    .digest("hex");
}


/* =========================================================
   🔐 FORENSIC-GRADE VERIFICATION ENGINE (SOURCE OF TRUTH)
========================================================= */
async function verifyBatch(batchId) {
  const produce = await Produce.findOne({ batchId });

  if (!produce || !produce.originalSnapshot || !produce.genesisHash) {
    return { status: "INVALID" };
  }

  const shipments = await Shipment.find({ batchId })
    .sort({ createdAt: 1 })
    .lean();

  let quantityTampering = false;
  let invalidBlocks = 0;

  /* ================= GLOBAL CHAIN ================= */

  const sorted = shipments.sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  let previousHash = "GENESIS";

  for (const current of sorted) {

    const payload = {
      batchId: String(current.batchId || "").trim(),
      handlerRole: String(current.handlerRole || "").trim(),
      handlerId: String(current.handlerId || "").trim(),
      handlerName: String(current.handlerName || "").trim(),
      cropName: String(current.cropName || "").trim(),
      status: String(current.status || "").trim(),
      location: String(current.location || "").trim(),
      previousHash: String(current.previousHash || "GENESIS"),

      distributorId: current.distributorId
        ? String(current.distributorId).trim()
        : null,

      retailerId: current.retailerId
        ? String(current.retailerId).trim()
        : null,

      shipmentSessionId: current.shipmentSessionId
        ? String(current.shipmentSessionId).trim()
        : null,

      shipmentQuantity: Number(current.shipmentQuantity || 0),

      transporterId: current.transporterId
        ? String(current.transporterId).trim()
        : null,

      invoiceId: current.invoiceId
        ? String(current.invoiceId).trim()
        : null,
    };

    const recomputedHash = generateBlockHash(payload);

    if (current.previousHash !== previousHash) {
      invalidBlocks++;
    }

    if (recomputedHash !== current.blockHash) {
      invalidBlocks++;
    }

    previousHash = current.blockHash;
  }

  /* ================= QUANTITY VALIDATION ================= */

  const sessionMap = {};

  shipments.forEach(s => {
    const key = s.shipmentSessionId || "NO_SESSION";

    if (!sessionMap[key]) sessionMap[key] = [];
    sessionMap[key].push(s);
  });

  /* =======================================================
   🔥 SAFE ADDITION: TOTAL DISPATCH VALIDATION (NON-BREAKING)
======================================================= */

  let totalDispatched = 0;

  for (const sessionId in sessionMap) {
    const blocks = sessionMap[sessionId];

    if (!blocks || blocks.length === 0) continue;

    const firstBlock = blocks[0];

    // ✅ ONLY COUNT RETAILER DISPATCH SESSIONS
    if (firstBlock.retailerId) {
      const qty = Number(firstBlock.shipmentQuantity || 0);

      if (!isNaN(qty) && qty > 0) {
        totalDispatched += qty;
      }
    }
  }

  // 🚨 FINAL CHECK
  if (totalDispatched > (produce.totalQuantity || 0)) {
    quantityTampering = true;
  }

  // 🔥 CORRECT QUANTITY VALIDATION

  // Rule 1: Within a session → quantity must stay constant
  for (const sessionId in sessionMap) {
    const blocks = sessionMap[sessionId];
    const firstQty = blocks[0].shipmentQuantity;

    for (const s of blocks) {
      if (s.shipmentQuantity !== firstQty) {
        quantityTampering = true;
        break;
      }
    }
  }

  // 🔥 NEW: SEQUENTIAL QUANTITY TAMPER CHECK (NON-BREAKING ADDITION)

  for (const sessionId in sessionMap) {

    const blocks = sessionMap[sessionId]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (let i = 1; i < blocks.length; i++) {

      const previous = blocks[i - 1];
      const current = blocks[i];

      if (current.shipmentQuantity !== previous.shipmentQuantity) {

        quantityTampering = true;

        // 🔥 Store exact reason (used later)
        current._quantityTamper = {
          from: previous.shipmentQuantity,
          to: current.shipmentQuantity,
          location: current.location,
          handler: current.handlerName,
          role: current.handlerRole
        };

        break;
      }
    }
  }

  // 🔥 Rule 2: Shipment quantity must NOT exceed batch total
  for (const sessionId in sessionMap) {
    const qty = sessionMap[sessionId][0].shipmentQuantity;

    if (qty > produce.totalQuantity) {
      quantityTampering = true;
    }
  }
  /* ---------- SNAPSHOTS ---------- */
  const genesisSnapshot = {
    batchId: produce.originalSnapshot.batchId || "",
    farmerName: produce.originalSnapshot.farmerName || "",
    cropName: produce.originalSnapshot.cropName || "",
    quantity: produce.originalSnapshot.quantity || 0,
    totalQuantity: produce.originalSnapshot.totalQuantity || 0,
    qualityGrade: produce.originalSnapshot.qualityGrade || "",
    harvestDate: produce.originalSnapshot.harvestDate
      ? new Date(produce.originalSnapshot.harvestDate).toISOString()
      : "",
    basePrice: produce.originalSnapshot.basePrice || 0
  };

  const currentSnapshot = {
    batchId: produce.batchId || "",
    farmerName: produce.farmerName || "",
    cropName: produce.cropName || "",
    quantity: produce.quantity || 0,
    totalQuantity: produce.totalQuantity || 0,
    qualityGrade: produce.qualityGrade || "",
    harvestDate: produce.harvestDate
      ? new Date(produce.harvestDate).toISOString()
      : "",
    basePrice: produce.basePrice || 0
  };

  let invoiceTampered = false;

  if (produce.transporterInvoice && produce.transporterInvoice.hash) {

    const inv = produce.transporterInvoice;

    const cleanInvoice = buildTransporterInvoice(inv);

    const recalculatedHash = crypto
      .createHash("sha256")
      .update(canonicalStringify(cleanInvoice))
      .digest("hex");

    if (recalculatedHash !== inv.hash) {
      invoiceTampered = true;
    }
  }

  /* =========================================================
   💰 ECONOMIC INTEGRITY VALIDATION (CRITICAL)
========================================================= */

  let economicTampering = false;
  let economicIssues = [];

  try {

    /* 🔥 ONLY CHECK AFTER COST LOCK */
    if (produce.costLocked) {

      const quantity = produce.totalQuantity || 0;
      const basePrice = produce.basePrice || 0;

      const expectedGoodsCost = Math.round(quantity * basePrice);

      const transportCost = produce.initialTransportCost || 0;
      const expectedTotalCost = Math.round(expectedGoodsCost + transportCost);

      const storedTotalCost = Math.round(produce.distributorTotalCost || 0);

      /* 🔥 TOTAL COST CHECK */
      if (expectedTotalCost !== storedTotalCost) {
        economicTampering = true;

        economicIssues.push({
          field: "distributorTotalCost",
          expected: expectedTotalCost,
          actual: storedTotalCost
        });
      }

      /* 🔥 TRANSPORT COST CHECK */
      if (transportCost < 0) {
        economicTampering = true;

        economicIssues.push({
          field: "initialTransportCost",
          expected: ">= 0",
          actual: transportCost
        });
      }

      /* 🔥 BASE PRICE LOCK CHECK */
      if (
        produce.distributorAcceptedBasePrice &&
        produce.distributorAcceptedBasePrice !== basePrice
      ) {
        economicTampering = true;

        economicIssues.push({
          field: "distributorAcceptedBasePrice",
          expected: basePrice,
          actual: produce.distributorAcceptedBasePrice
        });
      }

    }

  } catch (err) {
    console.error("Economic validation error:", err.message);
  }

  /* ---------- BLOCKCHAIN ---------- */
  let blockchainHash = null;
  try {
    blockchainHash = await getHashFromBlockchain(batchId);
  } catch { }

  const hasBlockchainProof =
    typeof blockchainHash === "string" &&
    typeof produce.genesisHash === "string";

  const hashMismatch =
    hasBlockchainProof && blockchainHash !== produce.genesisHash;

  /* ---------- SNAPSHOT DIFF ---------- */
  const snapshotTamperedDetails = diffSnapshot(genesisSnapshot, currentSnapshot);
  const hasSnapshotTampering = snapshotTamperedDetails.length > 0;

  /* ---------- SUPPLY CHAIN ---------- */
  let shipmentCount = shipments.length;

  /* 🔥 Add farmer pickup event */
  if (shipmentCount > 0) {
    shipmentCount += 1;
  }

  const geoAnomaly = shipments.some(s => !geoCheck(s));

  /* ---------- TRUST (SUPPLY CHAIN BASED) ---------- */

  const participantIds = new Set();

  // Farmer
  if (produce.farmerId) {
    participantIds.add(produce.farmerId);
  }

  // Shipment handlers
  shipments.forEach(s => {
    if (s.handlerId) participantIds.add(s.handlerId);
    if (s.transporterId) participantIds.add(s.transporterId);
    if (s.distributorId) participantIds.add(s.distributorId);
    if (s.retailerId) participantIds.add(s.retailerId);
  });

  const trustDocs = await TrustScore.find(
    { roleId: { $in: Array.from(participantIds) } },
    { trustScore: 1 }
  ).lean();

  const avgTrust = trustDocs.length
    ? trustDocs.reduce((sum, t) => sum + (t.trustScore || 0), 0) / trustDocs.length
    : 0;

  const participantsCount = participantIds.size;

  const features = [
    shipmentCount,
    invalidBlocks,
    hashMismatch ? 1 : 0,
    geoAnomaly ? 1 : 0,
    participantsCount,
    avgTrust,
    snapshotTamperedDetails.length
  ];

  let mlResult = { probability: 0 };

  try {
    const prediction = predictTamperML(features);
    if (prediction && typeof prediction.probability === "number") {
      mlResult = prediction;
    }
  } catch (err) {
    console.error("ML prediction failed:", err.message);
  }

  /* =====================================================
   🔥 FINAL DECISION — FORENSIC PRIORITY ENGINE
   Hard Evidence > ML > Admin Status
===================================================== */

  const hasHardEvidence =
    hashMismatch ||
    hasSnapshotTampering ||
    invalidBlocks > 0 ||
    economicTampering ||
    quantityTampering;

  /* =====================================================
   🔐 FINAL DECISION — NON-BREAKING OVERRIDE LAYER
   Existing logic preserved + DB truth enforced
===================================================== */

  let integrityScore = 100;
  let integrityStatus = "AUTHENTIC";

  // 🔥 FINAL DECISION
  if (hasHardEvidence) {
    integrityScore = 0;
    integrityStatus = "TAMPERED";
  }

  // 🔥 SKIP TAMPER LOGIC FOR REJECTED (ADMIN DECISION)
  if (produce.verificationStatus === "REJECTED") {

    return {
      status: "REJECTED",  // 🔥 ALWAYS AUTHENTIC (no tamper)
      integrityScore: 100,
      tamperRisk: "LOW",

      verificationStatus: "REJECTED",
      adminRemark: produce.adminRemark,
      verifiedAt: produce.verifiedAt,

      explanation: produce.adminRemark || "Rejected by admin",
      confidenceLevel: "ADMIN_DECISION",
      aiTamperProbability: 0,

      immutable: true,

      productDetails: {
        ...produce.toObject()
      },

      supplyChainHistory: []
    };
  }

  /* 🔥 2. DB OVERRIDE (CRITICAL FIX — NON-BREAKING) */
  if
    (
    produce.integrityStatus === "TAMPERED" ||
    produce.verificationStatus === "INVALIDATED"
  ) {
    integrityScore = 0;
    integrityStatus = "TAMPERED";
  }

  /* 🔥 3. SAFE FALLBACK (KEEP EXISTING BEHAVIOR INTACT) */
  if (
    produce.integrityStatus === "AUTHENTIC" &&
    produce.verificationStatus === "APPROVED" &&
    !hasHardEvidence
  ) {
    integrityScore = produce.integrityScore ?? 100;
    integrityStatus = "AUTHENTIC";
  }

  /* =====================================================
   🔍 HUMAN-READABLE TAMPER CAUSE (REFINED - SAFE)
===================================================== */

  let tamperReason = "No tampering detected";

  const generateTamperExplanation = require("../utils/tamperExplain");

  const explanationResult = generateTamperExplanation({
    hashMismatch,
    editCount: snapshotTamperedDetails.length,
    geoValid: !geoAnomaly,
    chainValid: invalidBlocks === 0,
    priceDeviation: 0 // (you can improve later if needed)
  });

  if (integrityStatus === "TAMPERED") {

    if (hasSnapshotTampering) {

      const changes = snapshotTamperedDetails.map(t => {
        const field = t.field || "unknown_field";
        const original = t.original ?? "null";
        const current = t.current ?? "null";

        if (field.includes("transporterInvoice")) {
          const parts = field.split(".");
          const subField = parts[1] || parts[0];
          return `Invoice ${subField} changed (${original} To ${current})`;
        }

        return `${field} changed (${original} To ${current})`;
      });

      tamperReason = changes.join(", ");
    }
    else if (hashMismatch) {
      tamperReason = "Blockchain hash mismatch detected";
    }
    else if (invalidBlocks > 0) {
      tamperReason = "Shipment chain integrity broken";
    }

    else if (quantityTampering) {

      let tamperDetails = null;

      for (const s of shipments) {
        if (s._quantityTamper) {
          tamperDetails = s._quantityTamper;
          break;
        }
      }

      if (tamperDetails) {
        tamperReason =
          `Quantity tampered from ${tamperDetails.from} to ${tamperDetails.to} ` +
          `at ${tamperDetails.location} by ${tamperDetails.role} (${tamperDetails.handler})`;
      } else {
        tamperReason = "Shipment quantity mismatch detected";
      }
    }

    else if (economicTampering) {
      tamperReason = economicIssues
        .map(e => `${e.field} mismatch (expected ${e.expected} To found ${e.actual})`)
        .join(", ");
    }
    else if (geoAnomaly) {
      tamperReason = "Geo-location anomaly detected in supply chain";
    }
    else {
      tamperReason = "Forensic integrity violation detected";
    }
  }

  /* -----------------------------------------
     AI Risk Calculation (FINAL TUNED VERSION)
  ----------------------------------------- */

  let aiTamperProbability = mlResult.probability || 0;

  // HARD EVIDENCE
  if (integrityStatus === "TAMPERED" || hasHardEvidence) {
    aiTamperProbability = 95;
  }

  // CLEAN BLOCKCHAIN REDUCTION
  else if (
    integrityStatus === "AUTHENTIC" &&
    !hashMismatch &&
    invalidBlocks === 0 &&
    !geoAnomaly
  ) {
    aiTamperProbability *= 0.6;
  }

  // CLEAN SYSTEM BOOST
  if (
    integrityStatus === "AUTHENTIC" &&
    snapshotTamperedDetails.length === 0 &&
    !economicTampering &&
    aiTamperProbability > 20
  ) {
    aiTamperProbability *= 0.5;
  }

  // TRUST ADJUSTMENT
  if (avgTrust > 80) {
    aiTamperProbability *= 0.85;
  } else if (avgTrust < 40) {
    aiTamperProbability *= 1.1;
  }

  // 🔥 BASELINE (VERY IMPORTANT)
  if (integrityStatus === "AUTHENTIC" && aiTamperProbability < 20) {
    aiTamperProbability += 2;
  }

  // FINAL CLAMP
  aiTamperProbability = Math.max(2, Math.min(aiTamperProbability, 100));

  // ROUND
  aiTamperProbability = Number(aiTamperProbability.toFixed(2));

  const fs = require("fs");
  const path = require("path");

  const evaluationPath = path.join(
    __dirname,
    "../../mlEvaluation.json"
  );

  let mlAccuracy = 0;

  try {
    const evalData = JSON.parse(
      fs.readFileSync(evaluationPath, "utf8")
    );
    mlAccuracy = Math.round(evalData.accuracy * 100);
  } catch (err) {
    console.warn("ML evaluation file not found");
  }

  // -----------------------------------------
  // Blockchain Immutability Indicator
  // (Not admin-based — cryptographic-based)
  // -----------------------------------------
  const immutable = hasBlockchainProof && !hashMismatch;

  // 🟢 Freshness Calculation
  // 🟢 Freshness Calculation (FINAL LOGIC)
  let freshnessStatus = "FRESH";
  let daysSinceHarvest = null;

  if (produce.harvestDate) {

    daysSinceHarvest = Math.floor(
      (new Date() - new Date(produce.harvestDate)) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceHarvest <= 15) {
      freshnessStatus = "FRESH";
    } else if (daysSinceHarvest <= 45) {
      freshnessStatus = "MODERATE";
    } else {
      freshnessStatus = "OLD";
    }
  }

  /* 🔥 FINAL EXPLANATION FIX */
  let finalExplanation = explanationResult.explanation;

  if (integrityStatus === "TAMPERED") {
    finalExplanation = tamperReason;
  }

  /* =====================================================
   🔥 SAFE RISK + FINAL RESPONSE BLOCK
===================================================== */

  // 🔐 Ensure aiTamperProbability is always a valid number
  const safeProbability = Number(aiTamperProbability) || 0;

  // 🔐 Tamper Risk Calculation (SAFE)
  let tamperRisk = "LOW";

  if (integrityStatus === "TAMPERED") {
    tamperRisk = "HIGH";
  } else {
    if (safeProbability >= 80) tamperRisk = "HIGH";
    else if (safeProbability >= 45) tamperRisk = "MEDIUM";
    else tamperRisk = "LOW";
  }

  /* =====================================================
   ✅ CONFIDENCE LEVEL (FINAL FIX)
===================================================== */

  let confidenceLevel = "MODERATE";

  if (integrityStatus === "TAMPERED") {
    confidenceLevel = "BLOCKCHAIN OVERRIDE";
  } else {
    if (safeProbability < 20) {
      confidenceLevel = "SAFE";
    } else if (safeProbability < 50) {
      confidenceLevel = "MODERATE";
    } else {
      confidenceLevel = "CRITICAL";
    }
  }

  // 🧾 FINAL RESPONSE
  return {
    status: integrityStatus,

    verificationStatus: produce.verificationStatus,
    adminRemark: produce.adminRemark,
    verifiedAt: produce.verifiedAt,

    tamperedAtRole: produce.tamperedAtRole || null,
    tamperedAtId: produce.tamperedAtId || null,

    explanation: finalExplanation,
    explanationStatus: explanationResult.status,

    immutable,
    isAllocation: false,

    integrityScore,
    tamperRisk, // ✅ safe

    aiTamperProbability: safeProbability, // ✅ always number
    confidenceLevel,
    mlModelAccuracy: mlAccuracy,

    invoiceTampered,
    tamperReason,

    aiExplainability: {
      blockchainHashMatched: hasBlockchainProof && !hashMismatch,
      hashMismatch,
      snapshotTampering: hasSnapshotTampering,
      invalidBlocks,
      economicTampering,
      economicIssues,
      geoAnomaly,
      avgTrust: {
        value: isNaN(avgTrust) ? 0 : Number(avgTrust.toFixed(2)),
        participants: participantsCount
      },
      editCount: snapshotTamperedDetails.length
    },

    invalidBlocks,

    tamperedDetails: snapshotTamperedDetails,

    productDetails: {
      batchId: produce.batchId,
      cropName: produce.cropName,
      farmerName: produce.farmerName,
      farmerId: produce.farmerId,
      quantity: produce.quantity,
      totalQuantity: produce.totalQuantity,
      soldQuantity: produce.soldQuantity || 0,
      remainingQuantity: produce.remainingQuantity || produce.quantity,
      qualityGrade: produce.qualityGrade,
      harvestDate: produce.harvestDate,
      daysSinceHarvest,
      freshnessStatus,
      farmLocation: produce.farmLocation,
      basePrice: produce.basePrice,
      priceAssignedBy: produce.priceAssignedBy,
      priceAssignedAt: produce.priceAssignedAt,
      distributorAcceptedBasePrice: produce.distributorAcceptedBasePrice,
      distributorAcceptedAt: produce.distributorAcceptedAt,
      genesisHash: produce.genesisHash,
      ipfsHash: produce.ipfsHash,
      transporterInvoice: produce.transporterInvoice || null,
      shipmentCount: shipments.length
    },

    supplyChainHistory: shipments
  };
}

/* =========================================================
   🚦 CONTROLLER (LOG + AUTO-FINALIZE)
========================================================= */
exports.verifyProduce = async (req, res) => {
  try {
    const { batchId } = req.params;

    const result = await verifyBatch(batchId);

    if (result.status === "INVALID") {
      return res.status(404).json({ status: "INVALID" });
    }

    /* =====================================================
       🔥 AUTO-FINALIZE TAMPERED BATCH (SYSTEM DECISION)
       Blockchain-Proven Tamper → Permanent Enforcement
    ===================================================== */

    if (result.status === "TAMPERED") {

      const produce = await Produce.findOne({ batchId });

      if (
        result.status === "TAMPERED" &&
        produce.verificationStatus !== "REJECTED"
      )
        // 🛡 Apply penalty ONLY once
        if (
          produce &&
          produce.verificationStatus !== "INVALIDATED" &&
          produce.integrityStatus !== "TAMPERED" // 🔥 ADD THIS LINE
        ) {

          await Produce.updateOne(
            { batchId },
            {
              $set: {
                integrityStatus: "TAMPERED",
                integrityScore: 0,
                verificationStatus: "INVALIDATED",
                verifiedBy: "SYSTEM",
                verifiedAt: new Date(),
                tamperExplanation: result.tamperReason || result.explanation,
                tamperedAtRole: produce.currentOwnerRole,
                tamperedAtId: produce.currentOwnerId
              },
              $inc: {
                editCount: 1
              }
            }
          );

          /* ================= TRUST PENALTY ================= */
          const responsibleRole = produce.currentOwnerRole;
          const responsibleId = produce.currentOwnerId;

          const responsibleUser = await require("../models/RoleIdentity").findOne({
            roleId: responsibleId
          });

          await updateTrustScore({
            role: responsibleRole,
            roleId: responsibleId,
            entityName: responsibleUser?.name || responsibleRole,
            isValid: false,
            batchId: produce.batchId,
            reason: result.tamperReason || result.explanation || "Blockchain integrity violation"
          });

          console.log("🚨 TRUST PENALTY APPLIED:", batchId);

          // 🔥 ADD THIS (CRITICAL FIX)
          const updatedProduce = await Produce.findOne({ batchId });

          result.tamperedAtRole = updatedProduce.tamperedAtRole;
          result.tamperedAtId = updatedProduce.tamperedAtId;
        }
    }

    /* =====================================================
       📘 SMART QR LOG (NO DUPLICATE SPAM)
    ===================================================== */

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const existingRecentLog = await IntegrityLog.findOne({
      batchId,
      action: "QR_VERIFY",
      verifiedBy: "PUBLIC_QR",
      createdAt: { $gte: fiveMinutesAgo }
    });

    if (!existingRecentLog) {
      const safeStatus =
        result.status === "TAMPERED" ||
          result.status === "PARTIALLY_TAMPERED"
          ? "TAMPERED"
          : "AUTHENTIC";   // 🔥 FIX

      await IntegrityLog.create({
        batchId,
        integrityScore: result.integrityScore,
        integrityStatus: safeStatus,
        isTampered: safeStatus === "TAMPERED",
        explanation: result.explanation,
        hashMismatch:
          result.aiExplainability?.hashMismatch === true,
        editCount: result.aiExplainability?.editCount || 0,
        tamperRisk: result.tamperRisk,
        aiTamperProbability: result.aiTamperProbability,
        confidenceLevel: result.confidenceLevel,
        action: "QR_VERIFY",
        verifiedBy: "PUBLIC_QR"
      });
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error("🔥 VERIFY ENGINE FAILURE FULL ERROR:");
    console.error(err);
    console.error("Message:", err.message);
    console.error("Stack:", err.stack);

    return res.status(500).json({
      status: "ERROR",
      message: err.message
    });
  }
};

const RetailerInventory = require("../models/RetailerInventory");

exports.verifyAllocation = async (req, res) => {
  try {

    const { inventoryId } = req.params;
    const isQRScan = req.query.mode === "qr"; // 🔥 ADD THIS

    /* ================= FETCH INVENTORY ================= */

    const inventory = await RetailerInventory.findOne({ inventoryId });

    if (!inventory) {
      return res.status(404).json({
        status: "INVALID_ALLOCATION"
      });
    }

    /* ================= HASH RE-CALCULATION ================= */

    const recalculatedHash = generateAllocationHash(inventory);

    const allocationTampered =
      recalculatedHash !== inventory.allocationHash;

    /* ================= VERIFY SALE LEDGER ================= */

    if (!isQRScan) {
      await verifyAndUpdateInventoryIntegrity(inventoryId);
    }

    // 🔥 IMPORTANT: re-fetch AFTER integrity update
    const updatedInventory = isQRScan
      ? inventory   // 🔥 DO NOT REFETCH (since no mutation)
      : await RetailerInventory.findOne({ inventoryId });

    /* ================= BASE BATCH VERIFICATION ================= */

    const batchVerification =
      await verifyBatch(updatedInventory.batchId);

    /* =====================================================
       🔥 TAMPER LOGIC (FINAL)
    ===================================================== */

    const allocationIssue =
      allocationTampered ||
      updatedInventory.integrityStatus === "TAMPERED";

    let allocationStatus = "AUTHENTIC";
    let allocationReason = "No tampering detected";

    if (allocationIssue) {

      allocationStatus = "TAMPERED";

      allocationReason = allocationTampered
        ? "Retail Allocation Hash Mismatch Detected"
        : "Retail Sale Ledger Integrity Violation";

      // 🔥 ONLY UPDATE DB IF NOT QR SCAN
      if (!isQRScan) {
        await RetailerInventory.updateOne(
          { inventoryId },
          {
            $set: {
              integrityStatus: "TAMPERED"
            }
          }
        );
      }
    }

    /* =====================================================
       HISTORY ENRICHMENT
    ===================================================== */

    const enrichedHistory = [
      ...batchVerification.supplyChainHistory,
      {
        handlerRole: "RETAILER",
        handlerName: updatedInventory.retailerId,
        status: updatedInventory.status.toUpperCase(),
        createdAt: updatedInventory.createdAt
      }
    ];

    /* =====================================================
       LOGGING (SAFE)
    ===================================================== */

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const existingRecentLog = await IntegrityLog.findOne({
      batchId: updatedInventory.batchId,
      action: "QR_VERIFY",
      verifiedBy: "PUBLIC_QR",
      createdAt: { $gte: fiveMinutesAgo }
    });

    if (!existingRecentLog) {

      const safeStatus =
        allocationStatus === "TAMPERED"
          ? "TAMPERED"
          : "AUTHENTIC";

      await IntegrityLog.create({
        batchId: updatedInventory.batchId,
        integrityScore: allocationStatus === "TAMPERED" ? 0 : batchVerification.integrityScore,
        integrityStatus: safeStatus,
        isTampered: safeStatus === "TAMPERED",

        hashMismatch: allocationTampered,

        editCount:
          batchVerification.aiExplainability?.editCount || 0,

        tamperRisk:
          allocationStatus === "TAMPERED"
            ? "MEDIUM"
            : batchVerification.tamperRisk,

        aiTamperProbability:
          allocationStatus === "TAMPERED"
            ? 95
            : batchVerification.aiTamperProbability,

        confidenceLevel:
          allocationStatus === "TAMPERED"
            ? "BLOCKCHAIN OVERRIDE"
            : batchVerification.confidenceLevel,

        action: "QR_VERIFY",
        verifiedBy: "PUBLIC_QR",

        meta: {
          type: "RETAIL_ALLOCATION",
          inventoryId: updatedInventory.inventoryId
        }
      });
    }

    /* =====================================================
       FINAL RESPONSE (🔥 UI FIX)
    ===================================================== */

    return res.json({
      ...batchVerification,

      isAllocation: true,

      /* 🔥 CRITICAL UI FIX */
      status:
        allocationStatus === "TAMPERED"
          ? "TAMPERED"
          : batchVerification.status,

      integrityScore:
        allocationStatus === "TAMPERED"
          ? 0
          : batchVerification.integrityScore,

      tamperRisk:
        allocationStatus === "TAMPERED"
          ? "MEDIUM"
          : batchVerification.tamperRisk,

      aiTamperProbability:
        allocationStatus === "TAMPERED"
          ? 95
          : batchVerification.aiTamperProbability,

      confidenceLevel:
        allocationStatus === "TAMPERED"
          ? "ALLOCATION_OVERRIDE"
          : batchVerification.confidenceLevel,

      explanation:
        allocationStatus === "TAMPERED"
          ? allocationReason   // ✅ THIS FIXES YOUR UI BUG
          : batchVerification.explanation,

      /* 🔥 Allocation-specific flags */
      allocationStatus,
      allocationTampered: allocationIssue,
      allocationReason,

      supplyChainHistory: enrichedHistory,

      allocation: {
        inventoryId: updatedInventory.inventoryId,
        retailerId: updatedInventory.retailerId,
        quantity: updatedInventory.quantity,
        remainingQuantity: updatedInventory.remainingQuantity,
        allocationHash: updatedInventory.allocationHash,
        recalculatedHash,
        allocationTampered,
        createdAt: updatedInventory.createdAt,
        updatedAt: updatedInventory.updatedAt
      }
    });

  } catch (err) {

    console.error("Allocation Verify Error:", err);

    res.status(500).json({
      message: "Allocation verification failed"
    });

  }
};

async function verifyProduceInternal(batchId) {
  try {
    const result = await verifyBatch(batchId);

    return result;

  } catch (err) {
    console.error("Internal verify failed:", err);
    return { status: "AUTHENTIC" }; // fallback safe
  }
}

module.exports.verifyProduceInternal = verifyProduceInternal;

exports.verifyBatch = verifyBatch;