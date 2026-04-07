const Produce = require("../models/Produce");
const Shipment = require("../models/Shipment");

const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const path = require("path");

const { generateBatchQR } = require("../utils/qrGenerator");
const uploadToIPFS = require("../utils/ipfsUpload");
const generateBlockHash = require("../utils/generateBlockHash");

const RoleIdentity = require("../models/RoleIdentity");

const updateTrustScore = require("../utils/updateTrustScore");
const buildTransporterInvoice = require("../utils/buildTransporterInvoice");
const { verifyBatch } = require("./verifyController");


const {
  storeHashOnBlockchain,
  getHashFromBlockchain,
  storeAdminVerificationOnBlockchain
} = require("../services/blockchainService");

const PDFDocument = require("pdfkit");

/* ======================================================
CREATE PRODUCE
====================================================== */
exports.createProduceBatch = async (req, res) => {
  try {
    const {
      farmerId,
      farmerName,
      cropName,
      quantity,
      qualityGrade,
      harvestDate,
      distributorId
    } = req.body;

    if (
      !farmerId ||
      !farmerName ||
      !cropName ||
      !quantity ||
      !qualityGrade ||
      !harvestDate
    ) {
      return res.status(400).json({
        message: "Missing required fields"
      });
    }

    const parsedQuantity = Number(quantity);

    if (isNaN(parsedQuantity) || parsedQuantity < 100 || parsedQuantity > 1000) {
      return res.status(400).json({
        message: "Batch quantity must be between 100 kg and 1000 kg"
      });
    }

    const canonicalDate = new Date(harvestDate);
    if (isNaN(canonicalDate.getTime())) {
      return res.status(400).json({
        message: "Invalid harvest date"
      });
    }

    const batchId = `BATCH-${uuidv4()}`;

    const payload = {
      batchId,
      farmerId: String(farmerId).trim(),
      farmerName: farmerName.trim(),
      cropName: cropName.trim(),
      quantity: parsedQuantity,
      qualityGrade: qualityGrade.trim(),
      harvestDate: canonicalDate.toISOString(),
      distributorId: distributorId || null,
      basePrice: 0
    };

    /* ================= SNAPSHOT (REQUIRED BY SCHEMA) ================= */

    const snapshot = {
      batchId: payload.batchId,
      farmerName: payload.farmerName,
      cropName: payload.cropName,
      quantity: payload.quantity,
      totalQuantity: payload.quantity,
      qualityGrade: payload.qualityGrade,
      harvestDate: payload.harvestDate,
      basePrice: payload.basePrice
    };

    const genesisHash = generateBlockHash(snapshot);

    let ipfsHash = "IPFS_UNAVAILABLE";

    try {
      ipfsHash = await uploadToIPFS(payload);
    } catch (err) {
      console.warn("⚠ IPFS upload failed, continuing without IPFS");
    }

    const produce = new Produce({
      ...payload,
      harvestDate: canonicalDate,
      ipfsHash,
      originalSnapshot: snapshot,   // ✅ REQUIRED
      genesisHash: genesisHash,     // ✅ REQUIRED
      integrityScore: 100,
      integrityStatus: "AUTHENTIC",
      verificationStatus: "PENDING"
    });

    await produce.save();

    /* ================= BLOCKCHAIN ================= */

    console.log("🔥 ENTERED BLOCKCHAIN SECTION");

    try {
      console.log("🚀 Sending to blockchain...");
      await storeHashOnBlockchain(batchId, genesisHash);
      console.log("✅ Blockchain success");
    } catch (err) {
      console.error("❌ Blockchain failed:", err.message);
    }

    const qrCode = await generateBatchQR(batchId);

    return res.status(201).json({
      status: "SUCCESS",
      batchId,
      qrCode,
      ipfsHash
    });

  } catch (err) {
    console.error("CREATE PRODUCE ERROR:", err);

    return res.status(500).json({
      message: "Failed to create produce batch"
    });
  }
};

exports.getRecentSubmissions = async (req, res) => {
  try {
    let { farmerId } = req.params;
    farmerId = String(farmerId).trim();

    const records = await Produce.find({ farmerId })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const result = await Promise.all(
      records.map(async (item) => ({
        batchId: item.batchId,
        cropName: item.cropName,
        quantity: item.quantity,
        harvestDate: item.harvestDate,
        integrityStatus: item.integrityStatus,
        integrityScore: item.integrityScore,
        verificationStatus: item.verificationStatus,
        adminRemark: item.adminRemark || "",
        qrCode: await generateBatchQR(item.batchId)
      }))
    );

    res.json(result);
  } catch (err) {
    console.error("RECENT SUBMISSIONS ERROR:", err);
    res.status(500).json({
      message: "Failed to fetch recent submissions"
    });
  }
};

/* ======================================================
RETAILER REQUEST
====================================================== */

exports.requestByRetailer = async (req, res) => {
  try {
    const { batchId } = req.params;
    const { retailerId } = req.body;

    const produce = await Produce.findOne({ batchId });

    try {
      const verification = await verifyBatch(batchId);

      if (verification.status?.includes("TAMPERED")) {
        return res.status(400).json({
          message: "Cannot request tampered batch"
        });
      }

    } catch (err) {
      console.warn("Verification check failed, continuing cautiously...");
    }

    if (!produce || produce.state !== "OWNED_BY_DISTRIBUTOR") {
      return res.status(400).json({ message: "Batch unavailable" });
    }

    // 🔒 BLOCK INVALID
    if (produce.verificationStatus !== "APPROVED") {
      return res.status(400).json({
        message: "Cannot request rejected batch"
      });
    }

    produce.state = "RETAILER_REQUESTED";
    produce.requestedRetailerId = retailerId;

    await produce.save();

    res.json({ message: "Retailer request submitted" });
  } catch {
    res.status(500).json({ message: "Retailer request failed" });
  }
};


/* ======================================================
VERIFY
====================================================== */
exports.verifyProduce = async (req, res) => {
  try {
    const { batchId } = req.params;

    const produce = await Produce.findOne({ batchId });

    /* ================= BASIC VALIDATION ================= */

    if (!produce) {
      return res.status(404).json({
        status: "INVALID",
        message: "Invalid batch ID"
      });
    }

    /* ================= APPROVAL CHECK ================= */
    // 🔥 Prevent crash if admin hasn't finalized snapshot

    if (!produce.originalSnapshot || !produce.genesisHash) {
      return res.json({
        status: "AUTHENTIC",
        message: "Batch not yet finalized by admin",
        history: []
      });
    }

    /* ================= FETCH SHIPMENTS ================= */

    const shipments = await Shipment.find({ batchId })
      .sort({ createdAt: 1 })
      .lean();

    /* ================= ORIGINAL SNAPSHOT ================= */

    const originalSnapshot = {
      batchId: produce.originalSnapshot.batchId,
      farmerName: produce.originalSnapshot.farmerName,
      cropName: produce.originalSnapshot.cropName,
      quantity: produce.originalSnapshot.quantity,
      qualityGrade: produce.originalSnapshot.qualityGrade,
      harvestDate: new Date(
        produce.originalSnapshot.harvestDate
      ).toISOString(),
      basePrice: produce.originalSnapshot.basePrice || 0
    };

    /* ================= CURRENT SNAPSHOT ================= */

    const currentSnapshot = {
      batchId: produce.batchId,
      farmerName: produce.farmerName,
      cropName: produce.cropName,
      quantity: produce.quantity,
      qualityGrade: produce.qualityGrade,
      harvestDate: produce.harvestDate
        ? new Date(produce.harvestDate).toISOString()
        : "",
      basePrice: produce.basePrice || 0
    };

    /* ================= HASH COMPUTATION ================= */

    const originalHash = produce.genesisHash; // 🔒 trusted baseline
    const currentHash = generateBlockHash(currentSnapshot);

    let blockchainHash = null;

    try {
      blockchainHash = await getHashFromBlockchain(batchId);
    } catch (err) {
      console.warn("Blockchain fetch failed");
    }

    /* ================= TAMPER DETECTION ================= */

    const hashMismatch =
      blockchainHash &&
      produce.genesisHash &&
      blockchainHash !== produce.genesisHash;

    const dataTamper = currentHash !== originalHash;

    const diffSnapshot = require("../utils/diffSnapshot");

    const changes = diffSnapshot(originalSnapshot, currentSnapshot);

    const tampered =
      hashMismatch ||
      dataTamper ||
      changes.length > 0;

    /* ================= RESPONSE ================= */

    return res.json({
      status: tampered ? "TAMPERED" : "AUTHENTIC",

      integrity: {
        blockchainHashMatched: !hashMismatch,
        dataIntegrityMaintained: !dataTamper
      },

      originalSnapshot,
      currentSnapshot,

      debug: {
        originalHash,
        currentHash,
        blockchainHash
      },

      history: shipments
    });

  } catch (err) {
    console.error("VERIFY ERROR:", err);

    return res.status(500).json({
      status: "ERROR",
      message: "Verification failed"
    });
  }
};

/* ======================================================
DUMMY EXPORTS (PREVENT ROUTE CRASH)
====================================================== */

exports.viewProduceReadonly = async (req, res) => {
  const produce = await Produce.findOne({ batchId: req.params.batchId });
  res.json(produce || {});
};


/* ======================================================
SELL PRODUCT
====================================================== */

exports.sellProduce = async (req, res) => {
  try {
    const { batchId } = req.params;
    const quantity = Number(req.body.quantity);
    const retailerId = req.body.retailerId;

    const produce = await Produce.findOne({ batchId });

    if (
      !produce ||
      produce.state !== "OWNED_BY_RETAILER" ||
      produce.currentOwnerId !== retailerId
    ) {
      return res.status(403).json({ message: "Unauthorized sale" });
    }

    if (produce.remainingQuantity < quantity) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    produce.soldQuantity += quantity;
    produce.remainingQuantity -= quantity;

    produce.salesLog.push({ quantity, retailerId, soldAt: new Date() });

    if (produce.remainingQuantity === 0) {
      produce.state = "SOLD";
    }

    await produce.save();

    res.json({
      message: "Sale recorded",
      remaining: produce.remainingQuantity
    });
  } catch {
    res.status(500).json({ message: "Sale failed" });
  }
};

/* ======================================================
ADMIN APPROVE / REJECT (FINAL FIXED VERSION)
====================================================== */

exports.approveProduce = async (req, res) => {
  try {
    const { batchId } = req.params;

    let adminRemark = req.body?.adminRemark;
    const basePrice = Number(req.body?.basePrice);

    if (!batchId) {
      return res.status(400).json({ message: "Batch ID required" });
    }

    if (!basePrice || basePrice <= 0) {
      return res.status(400).json({
        message: "Valid base price is required"
      });
    }

    if (typeof adminRemark !== "string" || adminRemark.trim() === "") {
      adminRemark = "Good Product";
    } else {
      adminRemark = adminRemark.trim();
    }

    const produce = await Produce.findOne({ batchId });

    if (!produce) {
      return res.status(404).json({ message: "Invalid Batch ID" });
    }

    if (produce.verificationStatus === "APPROVED") {
      return res.json({
        message: "Already approved",
        basePrice: produce.basePrice
      });
    }

    if (produce.integrityStatus === "TAMPERED") {
      return res.status(400).json({
        message: "Cannot approve a tampered batch"
      });
    }

    try {
      const verification = await verifyBatch(batchId);

      if (verification.status?.includes("TAMPERED")) {
        return res.status(400).json({
          message: "Cannot approve tampered batch"
        });
      }

    } catch (err) {
      console.warn("Verification check failed, fallback to DB check");
    }

    const now = new Date();

    /* ================= CORE APPROVAL ================= */

    produce.verificationStatus = "APPROVED";
    produce.integrityStatus = "AUTHENTIC";
    produce.integrityScore = 100;
    produce.state = "VERIFIED_BY_ADMIN";

    produce.verifiedBy = "ADMIN";
    produce.verifiedAt = now;
    produce.adminRemark = adminRemark;

    /* ================= BASE PRICE ================= */

    produce.basePrice = basePrice;
    produce.priceAssignedBy = "ADMIN";
    produce.priceAssignedAt = now;

    /* ================= FINAL SNAPSHOT ================= */

    const snapshot = {
      batchId: produce.batchId,
      farmerName: produce.farmerName,
      cropName: produce.cropName,
      quantity: produce.quantity,
      totalQuantity: produce.totalQuantity || produce.quantity,
      qualityGrade: produce.qualityGrade,
      harvestDate: new Date(produce.harvestDate).toISOString(),
      basePrice: produce.basePrice
    };

    const genesisHash = generateBlockHash(snapshot);

    produce.originalSnapshot = snapshot;
    produce.genesisHash = genesisHash;

    /* ================= SAVE ONCE ================= */
    await produce.save();

    /* ================= BLOCKCHAIN ================= */

    try {
      const existingHash = await getHashFromBlockchain(produce.batchId);

      if (!existingHash || existingHash === "") {
        await storeHashOnBlockchain(produce.batchId, genesisHash);
        console.log("✅ Blockchain stored");
      } else {
        console.log("⚠ Already exists on blockchain, skipping...");
      }

    } catch (err) {
      console.warn("Blockchain check failed, skipping store");
    }

    try {
      console.log("🚀 Storing admin verification...");
      await storeAdminVerificationOnBlockchain(
        produce.batchId,
        "ADMIN",
        adminRemark
      );
      console.log("✅ Admin verification stored");
    } catch (err) {
      console.error("❌ Admin blockchain failed:", err.message);
    }
    /* ================= TRUST UPDATE ================= */

    await updateTrustScore({
      role: "FARMER",
      roleId: produce.farmerId,
      entityName: produce.farmerName,
      isValid: true,
      batchId: produce.batchId,
      reason: "Batch approved by admin with base price assigned"
    });

    return res.status(200).json({
      message: "Batch approved successfully",
      batchId,
      verificationStatus: "APPROVED",
      basePrice
    });

  } catch (err) {
    console.error("Approve error:", err);
    return res.status(500).json({
      message: "Approval failed"
    });
  }
};


exports.rejectProduce = async (req, res) => {
  try {
    const { batchId } = req.params;
    let adminRemark = req.body?.adminRemark;

    if (!batchId) {
      return res.status(400).json({
        message: "Batch ID required"
      });
    }

    if (typeof adminRemark !== "string" || adminRemark.trim() === "") {
      adminRemark = "Batch rejected due to tampering";
    } else {
      adminRemark = adminRemark.trim();
    }

    const produce = await Produce.findOne({ batchId });

    if (!produce) {
      return res.status(404).json({
        message: "Invalid Batch ID"
      });
    }

    if (produce.verificationStatus === "REJECTED") {
      return res.json({
        message: "Already rejected",
        batchId
      });
    }

    const now = new Date();

    /* ================= CORE REJECTION ================= */

    produce.verificationStatus = "REJECTED";
    produce.integrityStatus = "AUTHENTIC";
    produce.integrityScore = 100;

    // Reset state back to farmer
    produce.state = "CREATED_BY_FARMER";

    produce.verifiedBy = "ADMIN";
    produce.verifiedAt = now;
    produce.adminRemark = adminRemark;

    /* ================= RESET BASE PRICE ================= */
    // If admin previously assigned price and now rejects,
    // clear pricing fields for safety.

    produce.basePrice = null;
    produce.priceAssignedBy = null;
    produce.priceAssignedAt = null;

    await produce.save();

    /* ================= TRUST PENALTY ================= */

    await updateTrustScore({
      role: "FARMER",
      roleId: produce.farmerId,
      entityName: produce.farmerName,
      isValid: false,
      batchId: produce.batchId,
      reason: "Batch rejected by admin"
    });

    return res.status(200).json({
      message: "Batch rejected successfully",
      batchId,
      verificationStatus: "REJECTED"
    });

  } catch (err) {
    console.error("Reject error:", err);
    return res.status(500).json({
      message: "Reject failed"
    });
  }
};

/* ======================================================
FARMER DASHBOARD
====================================================== */

exports.getProduceHistory = async (req, res) => {
  try {
    const { farmerId } = req.params;

    const query =
      farmerId === "ALL"
        ? {}
        : { farmerId: String(farmerId).trim() };

    const history = await Produce.find(query)
      .sort({ createdAt: -1 })
      .lean();

    const safeList = [];

    for (const batch of history) {

      try {
        const verification = await verifyBatch(batch.batchId);

        // 🔥 If tampered → update DB but DO NOT break flow
        if (verification.status?.includes("TAMPERED")) {

          await Produce.updateOne(
            { batchId: batch.batchId },
            {
              $set: {
                integrityStatus: "TAMPERED",
                integrityScore: 0,
                verificationStatus: "INVALIDATED",
                tamperExplanation:
                  verification.tamperReason || verification.explanation
              }
            }
          );
          safeList.push({
            ...batch,
            integrityStatus: "TAMPERED",
            verificationStatus: "INVALIDATED"
          });
          continue;
        }

        // ✅ Keep original structure intact
        safeList.push({
          ...batch,
          integrityStatus: verification.status || batch.integrityStatus
        });

      } catch (err) {
        console.warn("Verification skipped for batch:", batch.batchId);

        // ✅ Fallback → don't break existing flow
        safeList.push(batch);
      }
    }

    res.json(safeList);
  } catch (err) {
    console.error("HISTORY ERROR:", err);
    res.status(500).json({ message: "History fetch failed" });
  }
};

exports.getSubmissionFrequency = async (req, res) => {
  try {
    const { farmerId } = req.params;

    const data = await Produce.aggregate([
      { $match: { farmerId } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%d-%m",
              date: "$harvestDate"
            }
          },
          totalKg: { $sum: "$quantity" }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(data);
  } catch {
    res.status(500).json({ message: "Frequency fetch failed" });
  }
};

/* ======================================================
INVOICE PLACEHOLDERS
====================================================== */

exports.getTransporterInvoices = async (req, res) => {
  try {
    const { transporterId } = req.params;

    const produces = await Produce.find({
      "transporterInvoice.transporterId": transporterId
    }).lean();

    const invoices = produces
      .filter(p => p.transporterInvoice) // safety
      .map(p => ({
        invoiceId: p.batchId,
        batchId: p.batchId,
        farmerName: p.farmerName,
        cropName: p.cropName,
        quantity: p.quantity,
        uploadedAt: p.transporterInvoice.uploadedAt,
        transporterInvoice: p.transporterInvoice
      }));

    res.json(invoices);

  } catch (err) {
    console.error("Invoice fetch failed:", err);
    res.status(500).json({ message: "Failed to fetch invoices" });
  }
};

exports.downloadTransporterInvoice = async (req, res) => {
  try {
    const { batchId } = req.params;

    if (!batchId) {
      return res.status(400).json({ message: "Batch ID required" });
    }

    const produce = await Produce.findOne({ batchId }).lean();

    // 🔒 SHOW WARNING IF INVALID
    if (produce.verificationStatus !== "APPROVED") {
      console.warn("Generating invoice for non-approved batch");
    }

    if (!produce || !produce.transporterInvoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }


    const farmer = await RoleIdentity.findOne({ roleId: produce.farmerId }).lean();
    const distributor = await RoleIdentity.findOne({ roleId: produce.distributorId }).lean();

    /* ================= TAMPER DETECTION ================= */

    const originalInv = produce.originalSnapshot?.transporterInvoice || {};
    const currentInv = produce.transporterInvoice || {};

    const tamperedFields = [];

    const fieldMap = {
      transporterName: "Transporter",
      vehicleNumber: "Vehicle",
      charge: "Charge",
      fromLocation: "From",
      toLocation: "To"
    };

    Object.keys(fieldMap).forEach((key) => {
      const oldVal = originalInv[key];
      const newVal = currentInv[key];

      if (
        oldVal != null &&
        newVal != null &&
        oldVal !== newVal
      ) {
        tamperedFields.push({
          label: fieldMap[key],
          oldVal,
          newVal
        });
      }
    });

    const inv = produce.transporterInvoice;

    if (!inv.transporterName) {
      return res.status(400).json({ message: "Invalid invoice data" });
    }

    const fileName = `invoice-${batchId}.pdf`;

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );
    res.setHeader("Content-Type", "application/pdf");

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    doc.pipe(res);

    /* ================= BASIC DIMENSIONS ================= */

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentLeft = 60;
    const contentRight = pageWidth - 60;
    const contentWidth = contentRight - contentLeft;

    const primaryGreen = "#1E8449";
    const lightGreen = "#27AE60";

    /* ================= WATERMARK ================= */

    const logoPath = path.resolve(__dirname, "../../assets/AgriChainTrust1.png");

    const logoWidth = 420;

    doc.save();
    doc.opacity(0.5);
    doc.image(
      logoPath,
      (pageWidth - logoWidth) / 2,
      (pageHeight - logoWidth) / 2,
      { width: logoWidth }
    );
    doc.restore();

    /* ================= HEADER ================= */

    doc.rect(0, 0, pageWidth, 110).fill(primaryGreen);

    doc
      .fillColor("white")
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("AgriChainTrust System", contentLeft, 40);

    doc
      .font("Helvetica")
      .fontSize(14)
      .text("Transport Invoice", contentLeft, 65);

    doc
      .fontSize(10)
      .text(`Date: ${new Date().toLocaleDateString()}`, 0, 45, {
        align: "right"
      });

    doc.fillColor("black");
    doc.moveDown(5);

    /* ================= COMMON FIELD LAYOUT ================= */

    const leftColX = contentLeft;
    const rightColX = contentLeft + contentWidth / 2 + 10;

    let baseY = doc.y + 10;
    const rowGap = 26;

    const drawField = (label, value, x, y) => {
      doc.font("Helvetica-Bold").fontSize(11).text(label, x, y);
      doc.font("Helvetica").text(`: ${value || "N/A"}`, x + 110, y);
    };


    /* ================= FARMER DETAILS ================= */

    doc.font("Helvetica-Bold")
      .fontSize(15)
      .text("Farmer Details", contentLeft);

    doc.moveDown(0.5);

    baseY = doc.y + 10;

    drawField("Farmer", produce.farmerName, leftColX, baseY);
    drawField("Farmer ID", produce.farmerId, rightColX, baseY);

    drawField("Location", farmer?.location || "N/A", leftColX, baseY + rowGap);

    doc.y = baseY + rowGap + 50;


    /* ================= DISTRIBUTOR DETAILS ================= */

    doc.font("Helvetica-Bold")
      .fontSize(15)
      .text("Distributor Details", contentLeft);

    doc.moveDown(0.5);

    baseY = doc.y + 10;

    drawField(
      "Distributor",
      inv.distributorName || distributor?.name,
      leftColX,
      baseY
    );

    drawField(
      "Role ID",
      distributor?.roleId || produce.distributorId,
      rightColX,
      baseY
    );

    drawField(
      "Location",
      distributor?.location || inv.distributorLocation || "N/A",
      leftColX,
      baseY + rowGap
    );

    doc.y = baseY + rowGap + 50;

    /* ================= TRANSPORT DETAILS ================= */

    doc.font("Helvetica-Bold")
      .fontSize(14)
      .text("Transport Details", contentLeft);

    doc.moveDown(0.5);

    baseY = doc.y + 10;

    drawField("Transporter", inv.transporterName, leftColX, baseY);
    drawField("Vehicle", inv.vehicleNumber, rightColX, baseY);

    drawField("From", inv.fromLocation, leftColX, baseY + rowGap);
    drawField("To", inv.toLocation, rightColX, baseY + rowGap);

    doc.y = baseY + rowGap + 55;

    /* ================= AUTHENTICITY ================= */

    doc.font("Helvetica-Bold")
      .fontSize(14)
      .text("Batch Authenticity", contentLeft);

    doc.moveDown(0.5);

    baseY = doc.y + 10;

    drawField(
      "Harvest Date",
      new Date(produce.harvestDate).toLocaleDateString(),
      leftColX,
      baseY
    );

    drawField(
      "Quality Grade",
      produce.qualityGrade,
      rightColX,
      baseY
    );

    drawField(
      "Integrity",
      `${produce.integrityStatus} (${produce.integrityScore}%)`,
      leftColX,
      baseY + rowGap
    );

    if (tamperedFields.length > 0) {
      let tamperY = baseY + rowGap + 25;

      const tamperText = tamperedFields
        .map(field => `${field.label}: ${field.oldVal} -> ${field.newVal}`)
        .join(" | ");

      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("red")
        .text(
          `Tamper Alert: ${tamperText}`,
          leftColX,
          tamperY,
          {
            width: contentWidth,   // keeps alignment clean
            align: "left"
          }
        );

      doc.fillColor("black");

      doc.y = tamperY + 20; // spacing after line
    }

    drawField(
      "Admin Remark",
      produce.adminRemark,
      rightColX,
      baseY + rowGap
    );

    doc.y = Math.max(doc.y, baseY + rowGap + 60);


    /* ================= BATCH TABLE ================= */

    doc.font("Helvetica-Bold")
      .fontSize(15)
      .text("Batch Information", contentLeft);

    doc.moveDown(0.9);

    const tableTop = doc.y;

    // Make table use FULL content width
    doc.rect(contentLeft, tableTop, contentWidth, 30).fill(lightGreen);

    doc.fillColor("white").fontSize(11);

    // Adjusted widths to perfectly fit contentWidth
    const colWidths = [
      contentWidth * 0.30,
      contentWidth * 0.17,
      contentWidth * 0.15,
      contentWidth * 0.19,
      contentWidth * 0.19
    ];

    let colX = contentLeft;

    ["Batch ID", "Crop", "Quantity", "Product Price", "Transport Charge"].forEach((header, i) => {
      doc.text(header, colX, tableTop + 8, {
        width: colWidths[i],
        align: "center"
      });
      colX += colWidths[i];
    });

    const rowY = tableTop + 30;

    doc.fillColor("black");
    doc.rect(contentLeft, rowY, contentWidth, 48).stroke();

    // Vertical lines
    colX = contentLeft;
    for (let i = 1; i < colWidths.length; i++) {
      colX += colWidths[i - 1];
      doc.moveTo(colX, rowY)
        .lineTo(colX, rowY + 48)
        .stroke();
    }

    const basePrice = Number(produce.basePrice || 0);
    const quantity = Number(produce.quantity || 0);
    const transportCharge = Number(inv.charge || 0);

    const productPrice = quantity * basePrice;
    const totalAmount = productPrice + transportCharge;

    const formattedProductPrice = new Intl.NumberFormat("en-IN").format(productPrice);
    const formattedTransport = new Intl.NumberFormat("en-IN").format(transportCharge);
    const formattedTotal = new Intl.NumberFormat("en-IN").format(totalAmount);

    const rowValues = [
      produce.batchId,
      produce.cropName,
      `${quantity} kg`,
      `Rs. ${formattedProductPrice}`,
      `Rs. ${formattedTransport}`
    ];

    colX = contentLeft;

    rowValues.forEach((val, i) => {
      doc.fontSize(i === 0 ? 9 : 11);
      doc.text(val, colX, rowY + 16, {
        width: colWidths[i],
        align: "center"
      });
      colX += colWidths[i];
    });

    doc.y = rowY + 70;

    /* ================= TOTAL ================= */

    doc.moveDown(0.5);

    doc.font("Helvetica-Bold")
      .fontSize(17)
      .fillColor("#1E8449")
      .text(`Total Amount: Rs. ${formattedTotal}`, contentLeft, doc.y, {
        width: contentWidth,
        align: "right"
      });

    doc.fillColor("black");


    /* ================= DIGITAL SIGNATURE ================= */

    const tickPath = path.resolve(__dirname, "../../assets/greentick.png");

    const signWidth = 220;
    const signX = contentRight - signWidth;
    const signY = doc.y;

    const tickSize = 95;
    const tickX = signX + (signWidth - tickSize) / 2;
    const tickY = signY - 25;

    doc.save();
    doc.opacity(0.5);
    doc.image(tickPath, tickX, tickY, { width: tickSize });
    doc.restore();

    doc.font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#444")
      .text("Digitally Signed & Verified", signX, signY, {
        width: signWidth,
        align: "center"
      });

    doc.font("Helvetica")
      .fontSize(9)
      .text("AgriChainTrust Authority", signX, signY + 14, {
        width: signWidth,
        align: "center"
      });

    doc.end();

  } catch (err) {
    console.error("Invoice download error:", err);

    if (!res.headersSent) {
      res.status(500).json({
        message: "Invoice generation failed"
      });
    }
  }
};
