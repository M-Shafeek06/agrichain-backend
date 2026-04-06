const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

module.exports = async function generateInvoice(data) {
    const {
        invoiceId,
        batchId,
        farmer,
        transporter,
        produce,
        charges,
        blockchain
    } = data;

    const invoicesDir = path.join(__dirname, "../invoices");
    if (!fs.existsSync(invoicesDir)) fs.mkdirSync(invoicesDir);

    const filePath = path.join(invoicesDir, `${invoiceId}.pdf`);
    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(fs.createWriteStream(filePath));

    /* ================= HEADER ================= */
    doc
        .fontSize(20)
        .text("AgriChainTrust", { align: "left" })
        .fontSize(10)
        .text("Blockchain-Based Agricultural Traceability System")
        .moveUp()
        .fontSize(14)
        .text(`INVOICE`, { align: "right" })
        .fontSize(10)
        .text(`Invoice No: ${invoiceId}`, { align: "right" })
        .text(`Date: ${new Date().toLocaleDateString()}`, { align: "right" });

    doc.moveDown();

    /* ================= FARMER & TRANSPORTER ================= */
    doc.fontSize(11).text("Bill To (Farmer)", { underline: true });
    doc.fontSize(10)
        .text(`Name: ${farmer.name}`)
        .text(`Farmer ID: ${farmer.id}`)
        .text(`Location: ${farmer.location}`);

    doc.moveUp(4).fontSize(11).text("Collected By (Transporter)", {
        align: "right",
        underline: true
    });

    doc.fontSize(10).text(
        `Name: ${transporter.name}\nTransporter ID: ${transporter.id}\nVehicle No: ${transporter.vehicle}`,
        { align: "right" }
    );

    doc.moveDown(2);

    /* ================= PRODUCE TABLE ================= */
    doc.fontSize(11).text("Produce Details", { underline: true });
    doc.moveDown(0.5);

    const tableTop = doc.y;
    const col = [40, 170, 260, 330, 400, 480];

    doc.fontSize(9)
        .text("Crop", col[0], tableTop)
        .text("Batch ID", col[1], tableTop)
        .text("Qty (kg)", col[2], tableTop)
        .text("Grade", col[3], tableTop)
        .text("Harvest", col[4], tableTop)
        .text("Status", col[5], tableTop);

    const rowY = tableTop + 20;

    doc.fontSize(9)
        .text(produce.cropName, col[0], rowY)
        .text(batchId, col[1], rowY)
        .text(produce.quantity, col[2], rowY)
        .text(produce.grade, col[3], rowY)
        .text(produce.harvestDate, col[4], rowY)
        .text("COLLECTED", col[5], rowY);

    doc.moveDown(4);

    /* ================= CHARGES ================= */
    doc.fontSize(11).text("Transport Charges", { underline: true });
    doc.fontSize(10)
        .text(`Rate per Kg: ₹${charges.ratePerKg}`)
        .text(`Total Quantity: ${produce.quantity} kg`)
        .text(`Total Amount: ₹${charges.total}`, { bold: true });

    doc.moveDown(2);

    /* ================= BLOCKCHAIN SECTION ================= */
    doc.fontSize(11).text("Blockchain Verification", { underline: true });
    doc.fontSize(9)
        .text(`Batch ID: ${batchId}`)
        .text(`Block Hash: ${blockchain.blockHash}`)
        .text(`Transaction ID: ${blockchain.txId}`)
        .text(`Integrity Score: ${blockchain.integrity}%`);

    const qrData = `Batch:${batchId}\nTx:${blockchain.txId}`;
    const qrImage = await QRCode.toDataURL(qrData);

    doc.image(qrImage, 420, doc.y - 60, { width: 100 });

    doc.moveDown(4);

    /* ================= FOOTER ================= */
    doc
        .fontSize(9)
        .text(
            "This is a system-generated invoice issued upon produce collection.\nVerified and traceable via blockchain.",
            { align: "center" }
        );

    doc.end();

    return filePath;
};
