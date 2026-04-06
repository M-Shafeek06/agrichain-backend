const buildTransporterInvoice = require("./buildTransporterInvoice");

module.exports = function buildSnapshot(produce, shipments) {
  return {
    batchId: produce.batchId,
    farmerName: produce.farmerName,
    cropName: produce.cropName,
    quantity: produce.quantity,
    qualityGrade: produce.qualityGrade,

    harvestDate: new Date(
      Date.parse(produce.harvestDate)
    ).toISOString(),

    basePrice: produce.basePrice || 0,

    /* =====================================================
       🔐 FIXED TRANSPORTER INVOICE (CANONICAL STRUCTURE)
       - Ensures SAME structure for hashing
       - Works for both session 1 & session 2
       - Ignores dynamic fields like uploadedAt, hash
    ===================================================== */
    transporterInvoice: produce.transporterInvoice
      ? buildTransporterInvoice(produce.transporterInvoice)
      : null,

    ipfsHash: produce.ipfsHash,

    shipments: shipments.map(s => ({
      role: s.role,
      entity: s.entity,
      status: s.status,
      location: s.location,
      timestamp: new Date(
        Date.parse(s.timestamp)
      ).toISOString()
    }))
  };
};