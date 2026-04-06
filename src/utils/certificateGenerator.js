const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const QRCode = require("qrcode");

/* =========================================================
   🎓 AGRICHAINTRUST – VERIFICATION CERTIFICATE GENERATOR
   (FINAL – Border + Table + Page Number – SAFE VERSION)
========================================================= */
module.exports = async function generateCertificate(data) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  /* ================= FONTS ================= */
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  /* ================= COLORS ================= */
  const green = rgb(0.07, 0.45, 0.28);
  const red = rgb(0.75, 0.12, 0.12);
  const dark = rgb(0.15, 0.18, 0.22);
  const gray = rgb(0.45, 0.45, 0.45);
  const lightGray = rgb(0.92, 0.92, 0.92);
  const white = rgb(1, 1, 1);

  const isTampered = data.integrityStatus === "TAMPERED";

  /* ================= PAGE BORDER ================= */
  page.drawRectangle({
    x: 20,
    y: 20,
    width: width - 40,
    height: height - 40,
    borderColor: lightGray,
    borderWidth: 2
  });

  /* ================= HEADER ================= */
  page.drawRectangle({
    x: 20,
    y: height - 120,
    width: width - 40,
    height: 95,
    color: green
  });

  page.drawText("AgriChainTrust", {
    x: 40,
    y: height - 65,
    size: 26,
    font: fontBold,
    color: white
  });

  page.drawText(
    "Blockchain & AI Based Agricultural Produce Verification Certificate",
    {
      x: 40,
      y: height - 90,
      size: 12,
      font: fontRegular,
      color: rgb(0.9, 0.95, 0.92)
    }
  );

  page.drawText(`Certificate ID: ${data.batchId}`, {
    x: width - 285,
    y: height - 65,
    size: 10,
    font: fontRegular,
    color: white
  });

  page.drawText(`Issued: ${new Date().toLocaleString()}`, {
    x: width - 285,
    y: height - 83,
    size: 10,
    font: fontRegular,
    color: white
  });

  /* ================= STATUS STRIP ================= */
  const badgeColor = isTampered ? red : green;

  page.drawRectangle({
    x: 40,
    y: height - 175,
    width: width - 80,
    height: 44,
    color: badgeColor
  });

  page.drawText(
    isTampered
      ? "⚠ PRODUCT INTEGRITY COMPROMISED (TAMPERED)"
      : "✔ PRODUCT VERIFIED AS AUTHENTIC",
    {
      x: 60,
      y: height - 158,
      size: 16,
      font: fontBold,
      color: white
    }
  );

  /* ================= LAYOUT HELPERS ================= */
  let y = height - 225;

  const section = (title) => {
    page.drawText(title, {
      x: 40,
      y,
      size: 14,
      font: fontBold,
      color: dark
    });

    y -= 6;

    page.drawRectangle({
      x: 40,
      y,
      width: width - 80,
      height: 1,
      color: lightGray
    });

    y -= 18;
  };

  const row = (label, value) => {
    page.drawText(label, {
      x: 50,
      y,
      size: 11,
      font: fontBold,
      color: dark
    });

    page.drawText(String(value ?? "—"), {
      x: 235,
      y,
      size: 11,
      font: fontRegular,
      color: gray
    });

    y -= 18;
  };

  /* ================= TABLE HELPER ================= */
  const drawTable = (headers, tableRows, colWidths) => {
    const startX = 40;
    const rowHeight = 22;
    const tableWidth = width - 80;

    // Header row
    page.drawRectangle({
      x: startX,
      y: y - rowHeight,
      width: tableWidth,
      height: rowHeight,
      color: lightGray
    });

    let x = startX;
    headers.forEach((h, i) => {
      page.drawText(h, {
        x: x + 6,
        y: y - 15,
        size: 10,
        font: fontBold,
        color: dark
      });
      x += colWidths[i];
    });

    y -= rowHeight;

    // Data rows
    tableRows.forEach((rowData, idx) => {
      x = startX;

      if (idx % 2 === 0) {
        page.drawRectangle({
          x: startX,
          y: y - rowHeight,
          width: tableWidth,
          height: rowHeight,
          color: rgb(0.98, 0.98, 0.98)
        });
      }

      rowData.forEach((cell, i) => {
        page.drawText(String(cell), {
          x: x + 6,
          y: y - 15,
          size: 9,
          font: fontRegular,
          color: gray
        });
        x += colWidths[i];
      });

      y -= rowHeight;
    });

    // Table border
    page.drawRectangle({
      x: startX,
      y: y,
      width: tableWidth,
      height: rowHeight * (tableRows.length + 1),
      borderColor: lightGray,
      borderWidth: 1
    });

    y -= 22;
  };

  /* ================= PRODUCT INFO ================= */
  section("Product Information");

  row("Batch ID", data.batchId);
  row("Farmer Name", data.farmerName);
  row("Crop Name", data.cropName);
  row("Quantity", `${data.quantity} kg`);
  row("Quality Grade", data.qualityGrade);
  row("Harvest Date", new Date(data.harvestDate).toDateString());

  /* ================= VERIFICATION SUMMARY ================= */
  y -= 6;
  section("Verification Summary");

  row("Integrity Status", data.integrityStatus);
  row("Integrity Score", `${data.integrityScore}%`);
  row("Tamper Risk", data.tamperRisk || "N/A");
  row("AI Tamper Probability", `${data.aiTamperProbability ?? 0}%`);
  row("Confidence Level", data.confidenceLevel || "N/A");

  /* ================= TRACEABILITY TABLE ================= */
  y -= 6;
  section("Supply Chain Traceability Log");

  const tableHeaders = ["#", "Role", "Action", "Actor", "Location", "Timestamp"];

  const tableRows = (data.traceabilityLog || []).map((t, i) => [
    i + 1,
    t.role,
    t.action,
    t.actor,
    t.location,
    new Date(t.timestamp).toLocaleString()
  ]);

  drawTable(tableHeaders, tableRows, [30, 80, 100, 100, 110, 135]);

  /* ================= QR CODE ================= */
  const verifyUrl = `http://localhost:5173/produce/view/${data.batchId}`;
  const qrData = await QRCode.toDataURL(verifyUrl);
  const qrImage = await pdfDoc.embedPng(qrData);

  page.drawImage(qrImage, {
    x: width - 170,
    y: 120,
    width: 110,
    height: 110
  });

  page.drawText("Scan to Verify on Blockchain", {
    x: width - 185,
    y: 100,
    size: 9,
    font: fontRegular,
    color: gray
  });

  /* ================= FOOTER ================= */
  page.drawText(
    "This certificate is digitally generated and cryptographically anchored to the blockchain.",
    {
      x: 40,
      y: 52,
      size: 9,
      font: fontRegular,
      color: gray
    }
  );

  page.drawText(
    "AgriChainTrust • Decentralized Agricultural Produce Verification",
    {
      x: 40,
      y: 36,
      size: 9,
      font: fontBold,
      color: dark
    }
  );

  /* ================= PAGE NUMBER ================= */
  page.drawText("Page 1 of 1", {
    x: width / 2 - 30,
    y: 20,
    size: 9,
    font: fontRegular,
    color: gray
  });

  return await pdfDoc.save();
};
