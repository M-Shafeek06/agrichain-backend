const Produce = require("../models/Produce");
const Role = require("../models/RoleIdentity");
const PDFDocument = require("pdfkit");
const path = require("path");

const crypto = require("crypto");

const canonicalStringify = require("../utils/canonicalStringify");

const buildTransporterInvoice = require("../utils/buildTransporterInvoice");

function generateInvoiceHash(data) {
    return crypto
        .createHash("sha256")
        .update(canonicalStringify(data))
        .digest("hex");
}

exports.downloadInvoice = async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId || !batchId.trim()) {
            return res.status(400).json({ message: "Batch ID required" });
        }

        const produce = await Produce.findOne({ batchId: batchId.trim() }).lean();

        if (!produce) {
            return res.status(404).json({ message: "Invalid Batch ID" });
        }

        if (produce.verificationStatus !== "APPROVED") {
            return res.status(403).json({ message: "Invoice not uploaded yet" });
        }

        // 🔥 USE SESSION 1 INVOICE FROM PRODUCE
        const inv = produce.transporterInvoice;

        if (!inv) {
            return res.status(404).json({ message: "Invoice not found" });
        }

        let isTampered = false;

        /* ================= TAMPER CHECK ================= */

        const cleanInvoice = buildTransporterInvoice(inv);
        const currentHash = generateInvoiceHash(cleanInvoice);

        // ✅ Compare hashes
        if (inv.hash && inv.hash !== currentHash) {
            console.log("🚨 INVOICE TAMPERING DETECTED");
            console.log("Stored Hash:", inv.hash);
            console.log("Recalculated Hash:", currentHash);
            isTampered = true;
        }

        const farmer = await Role.findOne({ roleId: produce.farmerId }).lean();
        const transporter = inv.transporterId
            ? await Role.findOne({ roleId: inv.transporterId }).lean()
            : null;

        // 🔹 NEW: Distributor lookup
        const distributor = await Role.findOne({
            roleId: inv.distributorId
        }).lean();

        let tamperDetails = [];

        if (produce.originalSnapshot?.transporterInvoice) {
            const originalInv = produce.originalSnapshot.transporterInvoice;

            const fieldMap = {
                transporterName: "Transporter",
                transporterId: "Transporter ID",
                vehicleNumber: "Vehicle",
                transportDate: "Date",
                charge: "Charge",
                fromLocation: "From",
                toLocation: "To",
                distributorId: "Distributor ID",
                distributorName: "Distributor",
                distributorLocation: "Distributor Location",
                status: "Status"
            };

            Object.keys(fieldMap).forEach((key) => {
                let oldVal = originalInv[key];
                let newVal = inv[key];

                // Normalize values (important for date + number comparison)
                if (oldVal instanceof Date) oldVal = oldVal.toISOString();
                if (newVal instanceof Date) newVal = newVal.toISOString();

                if (
                    oldVal != null &&
                    newVal != null &&
                    String(oldVal) !== String(newVal)
                ) {
                    tamperDetails.push(
                        `${fieldMap[key]}: ${oldVal} -> ${newVal}`
                    );
                }
            });
        }


        const invoiceId = `INV-${Date.now()}`;
        const fileName = `${invoiceId}.pdf`;

        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        res.setHeader("Content-Type", "application/pdf");

        const doc = new PDFDocument({ margin: 35, size: "A4" });
        /* ================= WATERMARK LOGO ================= */

        const logoPath = path.join(
            __dirname,
            "../../../frontend/src/assets/AgriChainTrust1.png"
        );

        // A4 dimensions
        const pageWidth = doc.page.width;
        const pageHeight = doc.page.height;

        // Logo size (adjust if needed)
        const logoWidth = 500;
        const logoHeight = 500;

        // Center position
        const centerX = (pageWidth - logoWidth) / 2;
        const centerY = (pageHeight - logoHeight) / 2;

        // Save state
        doc.save();

        // Set low opacity
        doc.opacity(0.40);

        // Draw image
        doc.image(logoPath, centerX, centerY, {
            width: logoWidth,
            height: logoHeight
        });

        // Restore state
        doc.restore();
        doc.pipe(res);

        const primaryGreen = "#1E8449";
        const lightGreen = "#27AE60";

        /* ================= HEADER ================= */

        doc.rect(0, 0, doc.page.width, 100).fill(primaryGreen);

        doc.fillColor("white")
            .font("Helvetica-Bold")
            .fontSize(22)
            .text("AgriChainTrust System", 50, 35);

        doc.font("Helvetica")
            .fontSize(14)
            .text("Transport Invoice", 50, 62);

        doc.fontSize(11)
            .text(invoiceId, 350, 35, { align: "right" })
            .text(`Date: ${new Date().toLocaleDateString()}`, 350, 55, {
                align: "right"
            });

        doc.fillColor("black");
        doc.moveDown(4);

        if (isTampered) {
            doc
                .fillColor("red")
                .font("Helvetica-Bold")
                .fontSize(14)
                .text(
                    "TAMPERED INVOICE - DO NOT TRUST",
                    0,
                    110,
                    { align: "center" }   // ✅ CENTER
                );

            doc.fillColor("black");
        }

        if (isTampered && tamperDetails.length > 0) {
            doc
                .font("Helvetica")
                .fontSize(11)
                .fillColor("black")
                .text(
                    `Tamper Alert: ${tamperDetails.join(" | ")}`,
                    0,
                    130,
                    { align: "center" }   // ✅ CENTER
                );

            doc.moveDown(1.5);   // 🔥 adds vertical spacing
        }

        /* ================= FARMER / DISTRIBUTOR ================= */

        const leftX = 45;
        const rightX = 330;
        const baseY = doc.y;

        /* ---------- FARMER DETAILS ---------- */

        doc.font("Helvetica-Bold")
            .fontSize(13)
            .text("Farmer Details", leftX, baseY);

        doc.font("Helvetica").fontSize(12);

        doc.text(`Name           : ${produce.farmerName || "N/A"}`, leftX, baseY + 25);

        doc.text(
            `Organization: ${farmer?.organization || "N/A"}`,
            leftX,
            baseY + 45
        );

        doc.text(
            `Location       : ${farmer?.location || "N/A"}`,
            leftX,
            baseY + 65
        );

        /* ---------- DISTRIBUTOR DETAILS ---------- */

        doc.font("Helvetica-Bold")
            .fontSize(13)
            .text("Distributor Details", rightX, baseY);

        doc.font("Helvetica").fontSize(12);

        doc.text(
            `Name       : ${distributor?.name || "N/A"}`,
            rightX,
            baseY + 25
        );

        doc.text(
            `Location   : ${distributor?.location || "N/A"}`,
            rightX,
            baseY + 45
        );

        doc.y = baseY + 110;

        const baseAmount = produce.basePrice * produce.quantity;
        const totalAmount = baseAmount + inv.charge;

        const formattedTransport = new Intl.NumberFormat("en-IN").format(inv.charge);
        const formattedBase = new Intl.NumberFormat("en-IN").format(baseAmount);
        const formattedTotal = new Intl.NumberFormat("en-IN").format(totalAmount);

        /* ================= BATCH TABLE ================= */

        doc.font("Helvetica-Bold")
            .fontSize(13)
            .text("Batch Information", leftX);

        doc.moveDown(0.5);

        const tableTop = doc.y;
        const tableWidth = doc.page.width - leftX - 45;

        doc.rect(leftX, tableTop, tableWidth, 25).fill(lightGreen);

        doc.fillColor("white").fontSize(11);

        const cols = [
            { x: leftX, w: 130 },        // Batch ID
            { x: leftX + 130, w: 80 },   // Crop
            { x: leftX + 210, w: 60 },   // Qty
            { x: leftX + 270, w: 60 },   // Grade
            { x: leftX + 330, w: 80 },   // Base Price
            { x: leftX + 410, w: 90 }    // Transport
        ];
        const headers = ["Batch ID", "Crop", "Qty", "Grade", "Base Price", "Transport"];

        headers.forEach((h, i) => {
            doc.text(h, cols[i].x, tableTop + 7, {
                width: cols[i].w,
                align: "center"
            });
        });

        const rowY = tableTop + 25;

        doc.fillColor("black");
        doc.lineWidth(1.2);
        doc.rect(leftX, rowY, tableWidth, 40).stroke();

        cols.slice(1).forEach(c => {
            doc.moveTo(c.x, rowY)
                .lineTo(c.x, rowY + 40)
                .stroke();
        });

        const values = [
            produce.batchId,
            produce.cropName,
            `${produce.quantity} kg`,
            produce.qualityGrade,
            `Rs. ${produce.basePrice}/kg`,
            `Rs. ${formattedTransport}`
        ];

        values.forEach((v, i) => {

            // Special handling only for Batch ID
            if (i === 0) {
                doc.fontSize(9);   // slightly smaller to fit nicely
            } else {
                doc.fontSize(11);
            }

            doc.text(v, cols[i].x, rowY + 10, {
                width: cols[i].w,
                align: "center"
            });
        });

        doc.y = rowY + 55;

        /* ================= TRANSPORT DETAILS ================= */

        const drawRow = (label, value, y) => {
            const labelX = 50;
            const colonX = 170;
            const valueX = 190;

            doc.font("Helvetica").fontSize(11);

            // Label
            doc.text(label, labelX, y, { width: 110 });

            // Colon
            doc.text(":", colonX, y);

            // Value
            doc.text(value || "N/A", valueX, y);
        };

        let y = doc.y + 10;
        const gap = 18;

        /* ================= TRANSPORT DETAILS ================= */

        doc.font("Helvetica-Bold").fontSize(13).text("Transport Details", 50, y);
        y += 20;

        drawRow("Transporter", inv.transporterName, y); y += gap;
        drawRow("Vehicle", inv.vehicleNumber, y); y += gap;
        drawRow(
            "Date",
            new Date(inv.transportDate).toLocaleDateString(),
            y
        );

        y += gap + 10;

        /* ================= TRANSPORTER COMPLIANCE ================= */

        doc.font("Helvetica-Bold").text("Transporter Compliance", 50, y);
        y += 20;

        drawRow("License", transporter?.licenseNo, y); y += gap;
        drawRow("License Expiry", transporter?.licenseExpiry, y); y += gap;
        drawRow("Insurance Till", transporter?.insuranceTill, y); y += gap;
        drawRow("Vehicle Type", transporter?.vehicleType, y); y += gap;
        drawRow("Emergency Contact", transporter?.emergencyContact, y);

        y += gap + 10;

        /* ================= BATCH AUTHENTICITY ================= */

        doc.font("Helvetica-Bold").text("Batch Authenticity", 50, y);
        y += 20;

        drawRow(
            "Harvest Date",
            new Date(produce.harvestDate).toLocaleDateString(),
            y
        );
        y += gap;

        drawRow(
            "Integrity",
            `${produce.integrityStatus} (${produce.integrityScore}%)`,
            y
        );
        y += gap;

        drawRow("Admin Remark", produce.adminRemark, y);

        doc.y = y + 20;

        /* ================= TOTAL ================= */

        doc.text(`Crop Value: Rs. ${formattedBase}`, { align: "right" });
        doc.text(`Transport Charge: Rs. ${formattedTransport}`, { align: "right" });
        doc.moveDown(0.5);
        doc.font("Helvetica-Bold")
        doc.text(`Total Amount: Rs. ${formattedTotal}`, { align: "right" });

        doc.moveDown(1.5);

        /* ================= DIGITAL SIGNATURE ================= */
        /* ================= DIGITAL SIGNATURE ================= */

        const signY = doc.y;
        const blockWidth = 180;                      // width of signature block
        const blockX = doc.page.width - blockWidth - 45;

        // Tick image path
        const tickPath = path.join(
            __dirname,
            "../../../frontend/src/assets/greentick.png"
        );

        // Reduced tick size
        const tickSize = 95;

        // Calculate perfect center inside signature block
        const tickCenterX = blockX + (blockWidth / 2) - (tickSize / 2);
        const tickCenterY = signY - 20;   // adjusted slightly for visual balance

        // Draw background tick (low opacity)
        doc.save();
        doc.opacity(0.50);
        doc.image(tickPath, tickCenterX, tickCenterY, {
            width: tickSize
        });
        doc.restore();

        // Draw text centered on top
        doc.fontSize(10)
            .fillColor("#555")
            .font("Helvetica-Bold")
            .text("Digitally Signed & Verified", blockX, signY, {
                width: blockWidth,
                align: "center"
            });

        doc.font("Helvetica")
            .fontSize(9)
            .text("AgriChainTrust Authority", blockX, signY + 14, {
                width: blockWidth,
                align: "center"
            });
        doc.end();

    } catch (err) {
        console.error("INVOICE DOWNLOAD ERROR:", err);

        if (!res.headersSent) {
            res.status(500).json({ message: "Invoice generation failed" });
        }
    }
};