const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const crypto = require("crypto");
const path = require("path");
const { verifyBatch } = require("../services/verificationService");

const Profile = require("../models/Profile");
const RetailerInventory = require("../models/RetailerInventory");
const RoleIdentity = require("../models/RoleIdentity");
const Shipment = require("../models/Shipment");

exports.downloadCertificate = async (req, res) => {
  try {

    let { batchId } = req.params;

    let allocationData = null;
    let isAllocationCertificate = false;

    // 🔎 Allocation certificate mode
    if (batchId.startsWith("INV-")) {

      const inventory = await RetailerInventory.findOne({
        inventoryId: batchId
      });

      if (!inventory) {
        return res.status(400).json({
          message: "Invalid or fake product."
        });
      }

      allocationData = inventory;
      isAllocationCertificate = true;

      // anchor verification to parent batch
      batchId = inventory.batchId;
    }

    const verifiedData = await verifyBatch(batchId);
    if (!verifiedData || verifiedData.status === "INVALID") {
      return res.status(400).json({ message: "Invalid or fake product." });
    }

    /* ======================================================
    🔥 ADD THIS BLOCK RIGHT HERE
    ====================================================== */

    if (isAllocationCertificate && allocationData) {

      if (allocationData.integrityStatus === "TAMPERED") {

        // Override verification result
        verifiedData.status = "TAMPERED";
        verifiedData.integrityScore = 0;

        // Add reason
        verifiedData.tamperReason = "Retail Allocation Hash Mismatch Detected";

        // Add explainability
        verifiedData.aiExplainability = {
          ...verifiedData.aiExplainability,
          allocationTampering: true
        };

        // Add visible tamper details
        verifiedData.tamperedDetails = [
          ...(verifiedData.tamperedDetails || []),
          {
            field: "allocationHash",
            original: "Blockchain Stored",
            current: "Modified / Mismatch"
          }
        ];
      }
    }

    const product = verifiedData.productDetails;
    // 🔹 Fetch farmer profile for full farm address
    let farmAddress = "Verified Farm Source";

    const farmerProfile = await Profile.findOne({
      roleId: product.farmerId
    });

    if (farmerProfile) {
      farmAddress =
        `${farmerProfile.address}, ${farmerProfile.location} - ${farmerProfile.pincode}`;
    }

    // 🔹 SAFE SUPPLY HISTORY + DISTANCE CALCULATION
    /* ================= SUPPLY HISTORY (SESSION FILTERED) ================= */

    let supplyHistory = Array.isArray(verifiedData.supplyChainHistory)
      ? verifiedData.supplyChainHistory
      : [];

    /* ================= FILTER FOR CHILD CERTIFICATE ================= */

    let targetSessionId = null;

    if (isAllocationCertificate && allocationData?.sourceShipment) {
      const sourceShipment = await Shipment.findById(
        allocationData.sourceShipment
      ).lean();

      targetSessionId = sourceShipment?.shipmentSessionId || null;
    }

    const totalDistance = supplyHistory.reduce(
      (sum, s) => sum + (s.distance || 0),
      0
    );
    const verifyURL = isAllocationCertificate
      ? `http://localhost:5173/verify/${allocationData.inventoryId}`
      : `http://localhost:5173/verify/${batchId}`;
    const qrImage = await QRCode.toDataURL(verifyURL);

    const certificateId = `ACT-CERT-${new Date().getFullYear()}-${crypto
      .createHash("md5")
      .update(
        isAllocationCertificate
          ? allocationData.inventoryId
          : batchId
      )
      .digest("hex")
      .slice(0, 6)
      .toUpperCase()}`;

    const doc = new PDFDocument({ size: "A4", margin: 40 });

    const logoPath = path.join(
      __dirname,
      "../../../frontend/src/assets/AgriChainTrust1.png"
    );
    const drawWatermark = () => {
      const centerX = doc.page.width / 2 - 150;
      const centerY = doc.page.height / 2 - 150;

      doc.save(); // save current graphics state

      doc.opacity(0.20); // VERY IMPORTANT (controls watermark fade)

      doc.image(logoPath, centerX, centerY, {
        width: 300
      });

      doc.restore(); // restore graphics state
    };
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${isAllocationCertificate ? allocationData.inventoryId : batchId}_Final_Verification_Certificate.pdf`
    );

    doc.pipe(res);
    drawWatermark();

    /* ================= CONSTANTS ================= */
    const LEFT = 60;
    const LABEL_X = LEFT;
    const VALUE_X = LEFT + 170;
    const LINE = 14;

    /* ================= PAGE BORDER ================= */
    const drawBorder = () => {
      const m = 25;
      doc
        .rect(m, m, doc.page.width - m * 2, doc.page.height - m * 2)
        .lineWidth(1)
        .strokeColor("#d0d0d0")
        .stroke();
    };
    drawBorder();
    drawWatermark();

    doc.on("pageAdded", () => {
      drawBorder();
      drawWatermark();
    });

    /* ================= HEADER ================= */
    doc.font("Helvetica-Bold").fontSize(22).text("AgriChainTrust", { align: "center" });
    doc.moveDown(0.3);

    doc.font("Helvetica").fontSize(12).text(
      isAllocationCertificate
        ? "Retail Allocation Verification Certificate"
        : "Blockchain & AI Based Agricultural Produce Verification Certificate",
      { align: "center" }
    );

    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#555").text(
      "Issued by AgriChainTrust Verification Authority",
      { align: "center" }
    );
    doc.fillColor("black");
    doc.moveDown(0.5);

    /* ================= STATUS BADGE ================= */
    const batchStatus = String(verifiedData.status || "").toUpperCase();
    const allocationStatus = String(allocationData?.integrityStatus || "").toUpperCase();

    const isTampered =
      batchStatus === "TAMPERED" ||
      allocationStatus === "TAMPERED";

    const isRejected =
      product.verificationStatus === "REJECTED";

    const isVerified =
      !isTampered &&
      !isRejected &&   // ✅ CRITICAL FIX
      ["VERIFIED", "AUTHENTIC"].includes(batchStatus);

    const badgeY = doc.y;
    doc.roundedRect(180, badgeY, 235, 36, 6)
      .fill(
        isTampered
          ? "#c62828"
          : isRejected
            ? "#ef6c00"
            : "#2e7d32"
      );

    doc.fillColor("white").fontSize(10).text(
      isTampered
        ? "TAMPERED PRODUCT • DO NOT CONSUME"
        : isRejected
          ? "ADMIN REJECTED • NOT APPROVED FOR DISTRIBUTION"
          : "AUTHENTIC • VERIFIED ON BLOCKCHAIN",
      180,
      badgeY + 10, // 🔥 was 6 → move down a bit
      { width: 235, align: "center" }
    );

    doc.fillColor("black");
    doc.moveDown(2);

    /* ================= SECTION TITLE HELPER ================= */
    const sectionTitle = (title) => {

      const bottomLimit = doc.page.height - 120;
      if (doc.y > bottomLimit) {
        doc.addPage();
      }

      doc.moveDown(1); // uniform top spacing

      doc.font("Helvetica-Bold")
        .fontSize(14)
        .fillColor("#1b5e20")
        .text(title, LEFT);

      doc.fillColor("black");

      doc.moveDown(0.6); // uniform bottom spacing
    };

    /* ================= KEY–VALUE HELPER ================= */
    const kv = (label, value) => {

      const bottomLimit = doc.page.height - 100;

      if (doc.y > bottomLimit) {
        doc.addPage();
      }
      const y = doc.y;
      doc.fontSize(10).text(label, LABEL_X, y);
      doc.text(`: ${value ?? "—"}`, VALUE_X, y);
      doc.y = y + 16; // tighter spacing
    };

    /* ================= META ================= */
    kv("Certificate ID", certificateId);
    kv("Batch ID", batchId);
    kv("Issued On", new Date().toLocaleString());
    kv("Certificate Ver", "v1.0");
    doc.moveDown(0.5);

    /* ================= PRODUCT INFORMATION ================= */
    sectionTitle("Product Information");

    kv("Crop Name", product.cropName);
    kv("Farmer Name", product.farmerName);
    kv("Farm Origin", farmAddress);
    kv("Farm Organization", farmerProfile?.organization || "Registered Farm");
    kv("Quality Grade", product.qualityGrade);

    // 🔹 Show correct price depending on certificate type
    if (isAllocationCertificate) {
      const retailPriceRounded = Number(allocationData.retailerPerKgPrice || 0).toFixed(2);
      kv("Retail Price (Final)", `${retailPriceRounded} Rupees per kg`);
    } else {
      kv(
        "Base Price (Admin Assigned)",
        product.basePrice ? `${product.basePrice} Rupees per kg` : "Not Assigned"
      );
    }

    kv("Price Assigned By", product.priceAssignedBy);
    kv(
      "Price Assigned At",
      product.priceAssignedAt
        ? new Date(product.priceAssignedAt).toLocaleString()
        : "N/A"
    );

    if (isAllocationCertificate) {

      sectionTitle("Retail Allocation Details");

      // 🔎 Fetch retailer identity
      const retailerIdentity = await RoleIdentity.findOne({
        roleId: allocationData.retailerId
      });

      const retailerName = retailerIdentity
        ? retailerIdentity.name
        : "Registered Retail Partner";

      kv("Inventory ID", allocationData.inventoryId);

      // 🟢 Correct Retailer Identity
      kv("Retailer Name", retailerName);

      kv("Retailer ID", allocationData.retailerId);

      kv("Child Batch Quantity", `${allocationData.quantity} kg`);

      // 🟢 Parent Batch Proof
      kv("Parent Batch ID", batchId);

      kv(
        "Allocation Hash",
        allocationData.allocationHash
          ? allocationData.allocationHash.slice(0, 25) + "..."
          : "Not Available"
      );

      kv(
        "Retail Available On",
        allocationData.updatedAt
          ? new Date(allocationData.updatedAt).toLocaleString()
          : "Not Recorded"
      );

      kv(
        "Allocation Status",
        allocationData.status?.toUpperCase() || "AVAILABLE"
      );

    } else {

      kv("Total Harvest Quantity", product.quantity);

      sectionTitle("Distributor Acceptance");

      kv(
        "Distributor Accepted Price",
        product.distributorAcceptedBasePrice
          ? `${product.distributorAcceptedBasePrice} Rupees per kg`
          : "Not Assigned"
      );

      kv(
        "Accepted At",
        product.distributorAcceptedAt
          ? new Date(product.distributorAcceptedAt).toLocaleString()
          : "Not Recorded"
      );
    }

    kv(
      "Harvest Time",
      product.harvestDate
        ? new Date(product.harvestDate).toLocaleString()
        : "N/A"
    );
    // 🟢 Freshness Calculation (Consumer Friendly)
    if (product.harvestDate) {
      const daysSinceHarvest = Math.floor(
        (new Date() - new Date(product.harvestDate)) / (1000 * 60 * 60 * 24)
      );

      kv("Days Since Harvest", `${daysSinceHarvest} days`);

      // 🟢 Freshness Status
      let freshnessStatus = "FRESH";

      if (daysSinceHarvest <= 15) {
        freshnessStatus = "FRESH";
      } else if (daysSinceHarvest <= 45) {
        freshnessStatus = "MODERATE";
      } else {
        freshnessStatus = "OLD";
      }

      kv("Freshness Status", freshnessStatus);

      // 🛑 Consumer Safety Warning
      if (daysSinceHarvest > 45) {
        doc.moveDown(0.5);

        doc.font("Helvetica-Bold")
          .fontSize(11)
          .fillColor("#c62828")
          .text("CONSUMER WARNING: Product older than 45 days.");

        doc.text(
          "Food safety risk may increase. Consumers are advised not to consume this product."
        );

        doc.fillColor("black");
      }
    }
    if (isAllocationCertificate && allocationData?.sourceShipment) {

      const shipment = await Shipment.findById(
        allocationData.sourceShipment
      ).lean();

      // 🔥 FETCH CORRECT INVOICE
      let invoice = null;

      if (shipment?.invoiceId) {
        const Invoice = require("../models/Invoice"); // add model
        invoice = await Invoice.findOne({
          invoiceId: shipment.invoiceId
        }).lean();
      }

      if (shipment) {

        // ✅ KEEP SAME TITLE (no change)
        sectionTitle("Transport Summary");

        // ✅ USE INVOICE (NOT supplyHistory)
        kv("Transporter Name", invoice?.transporterName || shipment.transporterName || "—");

        kv("Vehicle Number", invoice?.vehicleNumber || "—");

        kv(
          "Route",
          `${invoice?.fromLocation || shipment.fromLocation || "—"} to ${invoice?.toLocation || shipment.toLocation || "—"}`
        );

        kv(
          "Transport Date",
          invoice?.transportDate
            ? new Date(invoice.transportDate).toLocaleDateString()
            : "N/A"
        );

        // 🔥 FINAL FIX (MAIN)
        kv(
          "Transport Charge",
          invoice?.charge
            ? `${invoice.charge} Rupees`
            : "Not Available"
        );

        kv("Invoice Status", shipment.status);
        kv("Shipment ID", shipment._id);

        doc.addPage();
      }
    }

    /* ================= TAMPER DETAILS ================= */

    if (isTampered) {

      sectionTitle("Tamper Analysis");

      doc.fillColor("#c62828")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Detected Tampering Details");

      doc.moveDown(0.5);

      // 🔥 Snapshot / Core Data Tampering
      if (Array.isArray(verifiedData.tamperedDetails) && verifiedData.tamperedDetails.length > 0) {
        verifiedData.tamperedDetails.forEach(t => {
          doc.font("Helvetica")
            .fontSize(10)
            .text(`• ${t.field}: ${t.original} to ${t.current}`);
        });
      }

      // 🔥 Allocation tampering (VERY IMPORTANT for your case)
      if (verifiedData.aiExplainability?.allocationTampering) {
        doc.text("• Allocation hash mismatch detected");
      }

      // 🔥 Sales / quantity tampering
      if (verifiedData.aiExplainability?.saleLedgerTampering) {
        doc.text("• Retail quantity / sales log inconsistency detected");
      }

      // 🔥 Blockchain / chain issues
      if (verifiedData.chainValid === false) {
        doc.text("• Shipment chain integrity broken");
      }

      doc.moveDown(0.5);

      // 🔥 Reason (if available)
      if (verifiedData.tamperReason) {
        doc.font("Helvetica-Bold")
          .text(`Reason: ${verifiedData.tamperReason}`);
      }

      doc.fillColor("black");
    }

    /* ================= VERIFICATION SUMMARY ================= */
    sectionTitle("Verification Summary");

    kv(
      "Blockchain Status",
      isTampered ? "INVALID" : "AUTHENTIC"
    );
    kv(
      "Verification Status",
      isRejected
        ? "REJECTED"
        : isTampered
          ? "INVALIDATED"
          : "APPROVED"
    );
    kv("Integrity Score", `${verifiedData.integrityScore}%`);
    kv("Tamper Risk Level", verifiedData.tamperRisk);
    kv("AI Tamper Probability", `${verifiedData.aiTamperProbability}%`);
    kv(
      "Confidence Level",
      isRejected ? "ADMIN FINAL DECISION" : verifiedData.confidenceLevel
    );
    kv(
      "ML Model Accuracy",
      isRejected
        ? "Not Applicable (Admin Override)"
        : `${verifiedData.mlModelAccuracy ?? 0}%`
    );

    if (isRejected) {

      sectionTitle("Admin Decision");

      kv("Verification Status", "REJECTED");

      kv("Rejected By", product.verifiedBy || "ADMIN");

      kv(
        "Rejected At",
        product.verifiedAt
          ? new Date(product.verifiedAt).toLocaleString()
          : "N/A"
      );

      kv(
        "Reason",
        product.adminRemark || "No reason provided"
      );

      doc.moveDown(0.5);

      doc.font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#ef6c00")
        .text("NOTICE: This product failed quality/compliance verification.");

      doc.text("Distribution and sale are not recommended.");

      doc.fillColor("black");
    }

    /* ================= BLOCKCHAIN INTEGRITY ================= */
    sectionTitle("Blockchain Integrity Proof");

    kv(
      "Genesis Hash",
      product.genesisHash
        ? product.genesisHash.slice(0, 20) + "..."
        : "Not Available"
    );

    kv(
      "IPFS Snapshot Hash",
      product.ipfsHash
        ? product.ipfsHash.slice(0, 20) + "..."
        : "Not Available"
    );

    let totalSessionShipments = 0;

    if (isAllocationCertificate && targetSessionId) {
      // 🔹 CHILD → farm + its own session
      totalSessionShipments = supplyHistory.filter(s =>
        s.shipmentSessionId === targetSessionId ||
        (s.distributorId && !s.retailerId)
      ).length;

    } else {
      // 🔹 PARENT → ALL EVENTS (NOT DB)
      totalSessionShipments = supplyHistory.length;
    }

    kv("Total Blockchain Events", totalSessionShipments);

    kv(
      "Chain Validation",
      verifiedData.chainValid === false
        ? "INVALID"
        : "VALID"
    );

    kv(
      "Tamper Detected",
      isTampered ? "YES" : "NO"
    );

    // 🛑 Consumer Safety Warning
    if (verifiedData.status === "TAMPERED") {
      doc.moveDown(0.5);
      doc.font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#c62828")
        .text("WARNING: This product shows blockchain inconsistency.");
      doc.text("Consumers are advised NOT to purchase this product.");
      doc.fillColor("black");
    }

    /* ================= BATCH / INVENTORY LIFECYCLE ================= */

    if (isAllocationCertificate && allocationData) {

      sectionTitle("Retail Inventory Lifecycle");

      kv("Parent Batch Quantity", `${product.quantity} kg`);
      kv("Inventory Allocated", `${allocationData.quantity} kg`);
      kv("Total Sold", `${allocationData.soldQuantity ?? 0} kg`);
      kv("Remaining Quantity", `${allocationData.remainingQuantity ?? 0} kg`);
      kv("Supply Distance Travelled", `${totalDistance.toFixed(2)} km`);

    } else {

      sectionTitle("Batch Lifecycle Summary");

      const totalProduced =
        product.originalSnapshot?.quantity ??
        product.totalQuantity ??
        product.quantity;

      // 🔥 TRUE allocation from inventories
      const inventories = await RetailerInventory.find({ batchId });

      const totalAllocated = inventories.reduce(
        (sum, inv) => sum + (inv.quantity || 0),
        0
      );

      // 🔥 Remaining = Produced - Allocated (NOT DB remaining)
      const remainingWarehouse = Math.max(
        0,
        totalProduced - totalAllocated
      );

      kv("Total Produced", `${totalProduced} kg`);
      kv("Allocated to Retailers", `${totalAllocated} kg`);
      kv("Remaining Warehouse Quantity", `${remainingWarehouse} kg`);
      kv("Total Blockchain Events", totalSessionShipments);
      kv("Supply Distance Travelled", `${totalDistance.toFixed(2)} km`);
    }
    /* ================= PREMIUM SUPPLY CHAIN ================= */

    doc.addPage();

    doc.font("Helvetica-Bold")
      .fontSize(14)
      .fillColor("black")
      .text("Tracking History", LEFT);

    doc.moveDown(0.8);

    const startX = LEFT + 100;
    let currentY = doc.y;


    /* ===== GROUP SESSIONS (FIXED) ===== */

    const sessions = {};
    const farmFlowRaw = []; // ✅ STORE FARM FLOW SEPARATELY

    supplyHistory.forEach(s => {

      // ✅ FARM → DISTRIBUTOR FLOW DETECTION
      if (s.distributorId && !s.retailerId) {
        farmFlowRaw.push(s);
        return;
      }

      const id = s.shipmentSessionId;

      if (!sessions[id]) sessions[id] = [];

      sessions[id].push(s);
    });

    const sortedSessions = Object.values(sessions).sort(
      (a, b) => new Date(a[0].createdAt) - new Date(b[0].createdAt)
    );

    /* ===== DRAW EVENT (UPDATED WITH NAME SUPPORT) ===== */
    const drawEvent = (event, isLast = false, indent = 0) => {

      const r = 5;
      const x = startX + indent;

      const blockHeight = event.extra ? 70 : 55;

      // 🔹 LINE (dynamic height)
      if (!isLast) {
        doc.moveTo(x, currentY + r)
          .lineTo(x, currentY + blockHeight)
          .lineWidth(2)
          .strokeColor("#2e7d32")
          .stroke();
      }

      // 🔹 DOT
      doc.circle(x, currentY, r).fill("#2e7d32");

      // 🔹 DATE (LEFT SIDE - PERFECT ALIGN)
      doc.fontSize(8)
        .fillColor("#777")
        .text(event.date, x - 95, currentY - 4, {
          width: 85,
          align: "right"
        });

      // 🔹 STATUS (MAIN TITLE)
      doc.font("Helvetica-Bold")
        .fontSize(10.5)
        .fillColor(event.color || "black")
        .text(event.status, x + 18, currentY - 8);

      // 🔹 TIME + LOCATION
      doc.font("Helvetica")
        .fontSize(9)
        .fillColor("#555")
        .text(`${event.time} • ${event.location}`, x + 18, currentY + 8);

      // 🔹 EXTRA (DISTANCE)
      let offsetY = currentY + 22;

      // ✅ Quantity FIRST
      if (event.quantity) {
        doc.fontSize(8)
          .fillColor("#444")
          .text(`Quantity: ${event.quantity} kg`, x + 18, offsetY);

        offsetY += 12;
      }

      // ✅ Then extra (distance / handled)
      if (event.extra) {
        doc.fontSize(8)
          .fillColor("#888")
          .text(event.extra, x + 18, offsetY);
      }

      // 🔹 MOVE CURSOR CLEANLY
      currentY += blockHeight;

      // 🔹 PAGE BREAK FIX
      if (currentY > doc.page.height - 120) {
        doc.addPage();
        currentY = 80;
      }
    };

    // 🔥 ROLE RESOLVER (ADD HERE)
    const resolveRoleLabel = (s, fallback = "Handler") => {

      if (s.handlerRole) {
        return s.handlerRole.charAt(0).toUpperCase() +
          s.handlerRole.slice(1).toLowerCase();
      }

      if (s.farmerId) return "Farmer";
      if (s.distributorId && !s.retailerId) return "Distributor";
      if (s.retailerId) return "Retailer";

      return fallback;
    };

    /* ===== EVENTS ===== */
    let mainFlow = [];
    let retailFlows = [];

    /* 🌾 HARVEST (FIRST ALWAYS) */
    if (!isAllocationCertificate) {
      const hDate = new Date(product.harvestDate);

      mainFlow.push({
        date: hDate.toDateString(),
        time: hDate.toLocaleTimeString(),
        location: product.farmLocation || "Farm",
        status: `Harvested (${product.farmerName} - Farmer)`,
        extra: null
      });
    }

    /* 🌾 FARM → DISTRIBUTOR FLOW (AFTER HARVEST) */
    if (farmFlowRaw.length > 0) {

      farmFlowRaw.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      for (const s of farmFlowRaw) {

        const d = new Date(s.createdAt);

        let status = "";
        const role = resolveRoleLabel(s);
        let actor = `${s.handlerName || "Unknown"} - ${role}`;

        switch (s.status) {

          case "PICKED_UP":
            status = "Picked Up";
            break;

          case "IN_TRANSIT":
            status = "In Transit";
            break;

          case "AT_DISTRIBUTOR":
          case "DELIVERED":
            status = "Delivered to Distributor";

            const distributor = await RoleIdentity.findOne({
              roleId: s.distributorId
            });

            actor = `${distributor?.name || "Distributor"} - Distributor`;
            break;

          default:
            status = s.status?.replace(/_/g, " ") || "Processed";
        }

        mainFlow.push({
          date: d.toDateString(),
          time: d.toLocaleTimeString(),
          location: s.location || "—",
          status: `${status} (${actor})`,
          quantity: s.shipmentQuantity,
          extra: s.distance
            ? `Distance: ${s.distance} km`
            : null
        });
      }
    }

    for (const session of sortedSessions) {

      session.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      const invoiceId = session[0]?.invoiceId;
      const isRetail = !!invoiceId && invoiceId !== "null";

      // 🔥 FILTER ONLY FOR CHILD CERTIFICATE
      if (isAllocationCertificate && targetSessionId) {
        if (session[0]?.shipmentSessionId !== targetSessionId) {
          continue; // ❌ skip other retail flows
        }
      }

      let flow = [];

      for (const s of session) {

        const d = new Date(s.createdAt);

        let status = "";
        let actor = "";

        const role = resolveRoleLabel(s);

        switch (s.status) {

          case "ASSIGNED_TO_TRANSPORTER":
            status = "Shipment Initiated";
            actor = `${s.handlerName || "Distributor"} - Distributor`;
            break;

          case "PICKED_UP":
            status = "Picked Up";
            actor = `${s.handlerName || "Transporter"} - ${role}`;
            break;

          case "IN_TRANSIT":
            status = "In Transit";
            actor = `${s.handlerName || "Transporter"} - ${role}`;
            break;

          case "AT_DISTRIBUTOR":
            status = "Delivered to Distributor";
            actor = `${s.handlerName || "Transporter"} - ${role}`;
            break;

          case "DELIVERED":

            if (isRetail) {
              status = "Delivered to Retailer";

              // ✅ GET RETAILER NAME
              const retailer = await RoleIdentity.findOne({
                roleId: s.retailerId
              });

              actor = `${retailer?.name || "Retailer"} - Retailer`;

            } else {
              status = "Delivered to Distributor";

              // ✅ GET DISTRIBUTOR NAME
              const distributor = await RoleIdentity.findOne({
                roleId: s.distributorId
              });

              actor = `${distributor?.name || "Distributor"} - Distributor`;
            }

            break;

          default:
            status = s.status?.replace(/_/g, " ") || "Processed";
            actor = `${s.handlerName || "Distributor"} - ${role}`;
        }

        flow.push({
          date: d.toDateString(),
          time: d.toLocaleTimeString(),
          location: s.location || "—",
          status: `${status} (${actor})`,
          quantity: s.shipmentQuantity,
          extra: s.distance
            ? `Distance: ${s.distance} km`
            : s.handlerRole
              ? `Handled by: ${s.handlerRole}`
              : null
        });
      }

      if (isRetail) {
        retailFlows.push({
          invoiceId,
          events: flow
        });
      } else {
        mainFlow.push(...flow);
      }
    }

    /* ===== RENDER ===== */

    // 🌾 MAIN FLOW
    doc.moveDown(0.6);

    doc.font("Helvetica-Bold")
      .fontSize(11)
      .fillColor("#1b5e20")
      .text("Farmer to Distributor", LEFT);

    doc.moveDown(0.8);   // 🔥 MORE GAP BEFORE FIRST NODE
    currentY = doc.y;

    mainFlow.forEach((e, i) => {
      drawEvent(e, i === mainFlow.length - 1, 0);
    });

    // 🌳 RETAIL TREE
    retailFlows.forEach((rf) => {

      doc.moveDown(0.8);

      doc.font("Helvetica-Bold")
        .fontSize(11)
        .fillColor("#1b5e20")
        .text(`Retail Allocation (${rf.invoiceId})`, LEFT);

      doc.moveDown(0.3);
      currentY += 20;

      rf.events.forEach((e, i) => {
        drawEvent(e, i === rf.events.length - 1, 0); // 🔥 INDENT = TREE
      });

    });

    /* ================= PAGE 2 – QR ================= */
    // Always start QR section on a new page
    doc.addPage();

    doc.fontSize(16).text("Online Certificate Re-Verification", { align: "center" });
    doc.moveDown(1);
    doc.fontSize(10).text(
      "This QR verifies the exact retail pack you are holding.\n\n" +
      "- If verification fails:\n" +
      "- Product may be counterfeit\n" +
      "- Do NOT consume\n" +
      "- Report to authority\n\n" +
      "If this page shows INVALID or TAMPERED, do not consume the product.",
      { align: "center" }
    );
    doc.moveDown(0.5);

    doc.fontSize(11).text(
      "Scan the QR code below to independently verify this certificate on AgriChainTrust.",
      { align: "center" }
    );

    const qrSize = 180;
    const qrX = (doc.page.width - qrSize) / 2;
    const qrY = doc.y + 20;

    doc.image(
      Buffer.from(qrImage.split(",")[1], "base64"),
      qrX,
      qrY,
      { width: qrSize }
    );

    doc.y = qrY + qrSize + 30;

    /* ================= AI + LEGAL ================= */
    doc.fontSize(10).text(
      "AI Verification Note:\nTamper probability is calculated using a machine learning anomaly detection model analyzing route deviation, timestamp integrity, and blockchain hash consistency."
    );

    doc.moveDown(1);

    doc.fontSize(9).text(
      "Legal Disclaimer:\nThis certificate is generated for traceability and verification purposes only. AgriChainTrust shall not be responsible for post-sale handling, storage conditions, or external contamination beyond blockchain-recorded events."
    );

    doc.moveDown(2);

    /* ================= AUTHORIZATION ================= */
    const authY = doc.y;
    doc.image(
      path.join(__dirname, "../../../frontend/src/assets/greentick.png"),
      doc.page.width - 210,
      authY + 2,
      { width: 14 }
    );

    doc.font("Helvetica-Bold").fontSize(10).text(
      "Authorized By:",
      doc.page.width - 190,
      authY
    );

    doc.font("Helvetica").text(
      "AgriChainTrust Verification Engine\n(Digitally Signed & Blockchain Anchored)",
      doc.page.width - 190,
      authY + 14
    );

    /* ================= BLOCKCHAIN FOOTER ================= */
    doc.fontSize(8).fillColor("#666").text(
      `Blockchain Anchor: ${certificateId.slice(0, 10)}…${certificateId.slice(-6)} • Network: Ethereum (Demo)`,
      LEFT,
      doc.page.height - 50
    );

    doc.end();
  } catch (err) {
    console.error("Certificate generation error:", err);
    res.status(500).json({ message: "Certificate generation failed." });
  }
};
