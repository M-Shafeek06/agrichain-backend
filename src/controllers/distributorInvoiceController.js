const Invoice = require("../models/Invoice");
const Role = require("../models/RoleIdentity");
const PDFDocument = require("pdfkit");
const RetailerRequest = require("../models/RetailerRequest");
const Produce = require("../models/Produce");

const crypto = require("crypto");
const canonicalStringify = require("../utils/canonicalStringify");

function generateInvoiceHash(data) {
    return crypto
        .createHash("sha256")
        .update(canonicalStringify(data)) // ✅ SAME AS DISPATCH
        .digest("hex");
}

/* =========================================================
   HELPER: SAFE DATE FORMAT
========================================================= */

function formatDate(date) {
    if (!date) return "N/A";
    try {
        return new Date(date).toLocaleDateString("en-IN");
    } catch {
        return "N/A";
    }
}

function buildInvoicePayload(invoice) {
    return {
        invoiceId: invoice.invoiceId,
        batchId: invoice.batchId,
        distributorId: invoice.distributorId,
        retailerId: invoice.retailerId,
        cropName: invoice.cropName,
        transporterName: invoice.transporterName,
        transporterId: invoice.transporterId,
        vehicleNumber: invoice.vehicleNumber,
        transportDate: String(invoice.transportDate),
        charge: Number(invoice.charge),
        fromLocation: invoice.fromLocation,
        toLocation: invoice.toLocation
    };
}

function detectTamperedFields(storedInvoice, currentPayload) {
    const tampered = [];

    const fields = [
        "invoiceId",
        "batchId",
        "distributorId",
        "retailerId",
        "cropName",
        "transporterName",
        "transporterId",
        "vehicleNumber",
        "transportDate",
        "charge",
        "fromLocation",
        "toLocation"
    ];

    fields.forEach(field => {
        const oldVal = storedInvoice[field];
        const newVal = currentPayload[field];

        if (String(oldVal) !== String(newVal)) {
            tampered.push({
                field,
                old: oldVal,
                new: newVal
            });
        }
    });

    return tampered;
}

/* =========================================================
   GET ALL DISTRIBUTOR INVOICES
========================================================= */

async function getDistributorInvoices(req, res) {
    try {
        const distributorId = req.headers["x-role-id"];

        if (!distributorId) {
            return res.status(401).json({
                message: "Distributor identity missing"
            });
        }

        const invoices = await Invoice.find({
            distributorId
        }).sort({ createdAt: -1 });

        return res.json(invoices);

    } catch (err) {
        console.error("Invoice fetch error:", err);
        return res.status(500).json({
            message: "Failed to load invoices"
        });
    }
}


/* =========================================================
   DOWNLOAD DISTRIBUTOR → RETAILER INVOICE (PDF)
========================================================= */

async function downloadDistributorInvoice(req, res) {
    try {
        /* ===== GET PARAM ===== */
        const { invoiceId } = req.params;

        if (!invoiceId) {
            return res.status(400).json({
                message: "Invoice ID required"
            });
        }

        /* ===== FETCH INVOICE (FIXED) ===== */
        const invoice = await Invoice.findOne({ invoiceId }).lean();

        if (!invoice) {
            return res.status(404).json({
                message: "Invoice not found"
            });
        }

        /* ===== AUTHORIZATION ===== */
        const userRole = req.user?.role;
        const userRoleId = req.user?.roleId;

        // Distributor → only their invoices
        if (userRole === "DISTRIBUTOR") {
            if (invoice.distributorId !== userRoleId) {
                return res.status(403).json({
                    message: "Unauthorized access"
                });
            }
        }

        // Retailer → only their invoices
        if (userRole === "RETAILER") {
            if (invoice.retailerId !== userRoleId) {
                return res.status(403).json({
                    message: "Unauthorized invoice access"
                });
            }
        }

        /* ================= TAMPER CHECK ================= */

        const currentHash = generateInvoiceHash(
            buildInvoicePayload(invoice)
        );

        let isTampered = false;
        let tamperedFields = [];

        if (invoice.hash && invoice.hash !== currentHash) {
            isTampered = true;

            if (invoice.originalPayload) {
                tamperedFields = detectTamperedFields(
                    invoice.originalPayload,
                    buildInvoicePayload(invoice)
                );
            }
        }

        const produce = await Produce.findOne({
            batchId: invoice.batchId
        }).lean();

        if (!produce) {
            return res.status(404).json({
                message: "Associated produce not found"
            });
        }

        /* ===== FETCH RETAILER REQUEST (FOR QUANTITY) ===== */

        const request = await RetailerRequest.findOne({
            invoiceId: invoice.invoiceId   // ✅ KEY FIX
        }).lean();

        const quantity = Number(
            invoice.shippedQuantity ||
            request?.requestedQty ||
            0
        );

        /* ===== FETCH ROLE DETAILS ===== */

        const distributor = await Role.findOne({
            roleId: invoice.distributorId
        }).lean();

        const retailer = await Role.findOne({
            roleId: invoice.retailerId
        }).lean();

        const transporter = await Role.findOne({
            roleId: invoice.transporterId
        }).lean();

        /* ===== CREATE PDF ===== */

        const doc = new PDFDocument({
            margin: 40,
            size: "A4"
        });

        const fileName = `${invoice.invoiceId}.pdf`;

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${fileName}"`
        );

        res.setHeader("Content-Type", "application/pdf");

        doc.pipe(res);

        const primaryGreen = "#1E8449";
        const lightGreen = "#27AE60";

        const path = require("path");

        const logoPath = path.resolve(__dirname, "../../assets/AgriChainTrust1.png");

        doc.save();
        doc.opacity(0.30);

        doc.image(
            logoPath,
            doc.page.width / 2 - 220,
            doc.page.height / 2 - 220,
            { width: 440 }
        );

        doc.restore();

        if (isTampered) {
            doc.save();
            doc.opacity(0.15);
            doc.fontSize(80)
                .fillColor("red")
                .text("TAMPERED", 100, 300, {
                    angle: 45
                });
            doc.restore();
        }

        /* ================= HEADER ================= */

        doc.rect(0, 0, doc.page.width, 100).fill(primaryGreen);

        doc.fillColor("white")
            .font("Helvetica-Bold")
            .fontSize(22)
            .text("AgriChainTrust", 50, 35);

        doc.font("Helvetica")
            .fontSize(14)
            .text(
                "Distributor To Retailer Logistics Invoice",
                50,
                65,
                { align: "center", width: doc.page.width - 100 }
            );

        doc.fontSize(11)
            .text(invoice.invoiceId, 350, 35, { align: "right" })
            .text(`Date: ${formatDate(invoice.createdAt)}`, 350, 55, {
                align: "right"
            });

        doc.fillColor("black");
        doc.moveDown(4);

        /* ================= TAMPER ALERT ================= */

        if (isTampered) {

            // 🔴 Centered Heading
            doc
                .fillColor("red")
                .font("Helvetica-Bold")
                .fontSize(18)
                .text("TAMPERED INVOICE", 0, 110, {
                    align: "center",
                    width: doc.page.width
                });

            // 🔴 Centered Reason
            doc
                .font("Helvetica")
                .fontSize(11)
                .text("Reason: Invoice data mismatch detected", 0, 130, {
                    align: "center",
                    width: doc.page.width
                });

            // ✅ Reset color immediately
            doc.fillColor("black");

            // Better spacing
            doc.moveDown(1.5);
        }
        if (isTampered && tamperedFields.length > 0) {

            doc.moveDown(0.5);

            // Convert all fields into single-line string
            const fieldText = tamperedFields
                .map(f => `${f.field}: ${f.old} to ${f.new}`)
                .join("  |  ");

            // 🔴 Centered Tampered Fields
            doc
                .font("Helvetica-Bold")
                .fontSize(10)
                .fillColor("red")
                .text(`Tampered Fields: ${fieldText}`, 0, doc.y, {
                    align: "center",
                    width: doc.page.width
                });

            // ✅ Reset color
            doc.fillColor("black");

            // Better spacing
            doc.moveDown(1.2);
        }

        /* ================= PARTY DETAILS ================= */

        const leftX = 50;
        const rightX = 330;
        const baseY = doc.y;

        const labelWidth = 90;

        doc.font("Helvetica-Bold").fontSize(13).text("Distributor Details", leftX, baseY);
        doc.font("Helvetica").fontSize(12);

        doc.text("Name", leftX, baseY + 25, { width: labelWidth });
        doc.text(`: ${distributor?.name || "N/A"}`, leftX + labelWidth, baseY + 25);

        doc.text("Location", leftX, baseY + 45, { width: labelWidth });
        doc.text(`: ${distributor?.location || "N/A"}`, leftX + labelWidth, baseY + 45);


        doc.font("Helvetica-Bold").fontSize(13).text("Retailer Details", rightX, baseY);
        doc.font("Helvetica");

        doc.text("Name", rightX, baseY + 25, { width: labelWidth });
        doc.text(`: ${retailer?.name || "N/A"}`, rightX + labelWidth, baseY + 25);

        doc.text("Location", rightX, baseY + 45, { width: labelWidth });
        doc.text(`: ${retailer?.location || "N/A"}`, rightX + labelWidth, baseY + 45);

        doc.y = baseY + 90;

        /* ================= TRANSPORT DETAILS ================= */

        const sectionX = 50;

        doc.font("Helvetica-Bold")
            .fontSize(13)
            .text("Transport Details", sectionX);

        doc.font("Helvetica").fontSize(12);

        doc.text("Transporter", sectionX);
        doc.text(`: ${invoice.transporterName || "N/A"}`, sectionX + 120, doc.y - 14);

        doc.text("Vehicle", sectionX);
        doc.text(`: ${invoice.vehicleNumber || "N/A"}`, sectionX + 120, doc.y - 14);

        doc.text("Transport Date", sectionX);
        doc.text(`: ${formatDate(invoice.transportDate)}`, sectionX + 120, doc.y - 14);

        if (transporter) {
            doc.moveDown(0.5);
            doc.font("Helvetica-Bold")
                .text("Transporter Compliance", sectionX);
            doc.font("Helvetica");

            const colonX = sectionX + 120;
            const valueX = sectionX + 135;

            doc.text("License", sectionX);
            doc.text(":", colonX, doc.y - 14);
            doc.text(transporter?.licenseNo || "N/A", valueX, doc.y - 14);

            doc.text("Vehicle Type", sectionX);
            doc.text(":", colonX, doc.y - 14);
            doc.text(transporter?.vehicleType || "N/A", valueX, doc.y - 14);

            doc.text("Emergency Contact", sectionX);
            doc.text(":", colonX, doc.y - 14);
            doc.text(transporter?.emergencyContact || "N/A", valueX, doc.y - 14);
        }

        doc.moveDown(1.5);

        /* ================= SHIPMENT TABLE ================= */

        doc.font("Helvetica-Bold")
            .fontSize(13)
            .text("Shipment Summary", sectionX);

        doc.moveDown(0.5);

        const tableTop = doc.y;
        const tableWidth = doc.page.width - 100;

        doc.rect(50, tableTop, tableWidth, 25).fill(lightGreen);

        doc.fillColor("white").fontSize(11);

        const headers = ["Batch ID", "Crop", "Quantity", "Amount"];

        const cols = [
            { x: 50, w: 200 },   // Batch
            { x: 250, w: 120 },  // Crop
            { x: 370, w: 80 },   // Quantity
            { x: 450, w: 90 }    // Amount
        ];

        headers.forEach((h, i) => {
            doc.text(h, cols[i].x, tableTop + 7, {
                width: cols[i].w,
                align: "center"
            });
        });

        const rowY = tableTop + 25;

        doc.fillColor("black");
        doc.rect(50, rowY, tableWidth, 40).stroke();

        const basePrice = Number(produce?.basePrice || 0);
        const transportCharge = Number(invoice.charge || 0);

        const PROFIT_PERCENT = 0.15;

        const baseGoodsCost = basePrice * quantity;
        const profitAmount = baseGoodsCost * PROFIT_PERCENT;
        const goodsCost = baseGoodsCost + profitAmount;
        const totalCost = goodsCost + transportCharge;

        const formattedGoods = new Intl.NumberFormat("en-IN").format(goodsCost);
        const formattedTransport = new Intl.NumberFormat("en-IN").format(transportCharge);
        const formattedTotal = new Intl.NumberFormat("en-IN").format(totalCost);

        const values = [
            invoice.batchId,
            invoice.cropName,
            `${quantity} kg`,
            `Rs. ${formattedGoods}`
        ];

        values.forEach((v, i) => {
            doc.text(v, cols[i].x, rowY + 10, {
                width: cols[i].w,
                align: "center"
            });
        });

        doc.y = rowY + 60;

        /* ================= TOTAL ================= */

        doc.font("Helvetica").fontSize(12);

        const totalLabelX = 350;
        const totalColonX = 470;
        const totalValueX = 485;

        // 👉 calculate values (ensure these exist above)
        const formattedBaseCost = baseGoodsCost.toFixed(2);
        const formattedProfit = profitAmount.toFixed(2);

        // ===== Base Cost =====
        doc.text("Base Cost", totalLabelX);
        doc.text(":", totalColonX, doc.y - 14);
        doc.text(`Rs. ${formattedBaseCost}`, totalValueX, doc.y - 14);

        // ===== Profit =====
        doc.text("Profit (15%)", totalLabelX);
        doc.text(":", totalColonX, doc.y - 14);
        doc.text(`Rs. ${formattedProfit}`, totalValueX, doc.y - 14);

        // ===== Goods Amount =====
        doc.text("Goods Amount", totalLabelX);
        doc.text(":", totalColonX, doc.y - 14);
        doc.text(`Rs. ${formattedGoods}`, totalValueX, doc.y - 14);

        // ===== Transport =====
        doc.text("Transport Charge", totalLabelX);
        doc.text(":", totalColonX, doc.y - 14);
        doc.text(`Rs. ${formattedTransport}`, totalValueX, doc.y - 14);

        doc.moveDown(0.5);

        // ===== TOTAL =====
        doc.font("Helvetica-Bold");

        doc.text("Total Amount", totalLabelX);
        doc.text(":", totalColonX, doc.y - 14);
        doc.text(`Rs. ${formattedTotal}`, totalValueX, doc.y - 14);

        doc.moveDown(0.5);
        doc.moveDown(1.5);

        /* ================= SIGNATURE ================= */

        const tickPath = path.resolve(__dirname, "../../assets/greentick.png");

        const signY = doc.y;
        const blockWidth = 180;
        const blockX = doc.page.width - blockWidth - 45;

        doc.save();
        doc.opacity(0.35);

        doc.image(tickPath, blockX + 50, signY - 15, {
            width: 60
        });

        doc.restore();

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
        console.error("Invoice PDF error:", err);

        if (!res.headersSent) {
            res.status(500).json({
                message: "Invoice generation failed"
            });
        }
    }
}

/* =========================================================
   EXPORT CLEANLY (CRITICAL FOR EXPRESS)
========================================================= */

module.exports = {
    getDistributorInvoices,
    downloadDistributorInvoice
};
