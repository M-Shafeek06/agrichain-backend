const Shipment = require("../models/Shipment");
const TrustScore = require("../models/TrustScore");

module.exports = async function generateDataset() {

  const shipments = await Shipment.find({ handlerRole: "TRANSPORTER" }).lean();
  const dataset = [];

  const trustDocs = await TrustScore.find({}, { trustScore: 1 }).lean();

  const avgTrust =
    trustDocs.length === 0
      ? 100
      : trustDocs.reduce((sum, t) => sum + (t.trustScore || 0), 0) /
      trustDocs.length;

  for (const s of shipments) {

    const features = [
      s.isValid === false ? 1 : 0,
      s.chainValid === false ? 1 : 0,
      s.distance > 150 ? 1 : 0,
      s.shipmentQuantity > 300 ? 1 : 0,
      avgTrust,
      s.status === "IN_TRANSIT" ? 1 : 0
    ];

    const label =
      (!s.isValid ||
        !s.chainValid ||
        s.distance > 200 ||
        s.shipmentQuantity > 400) ? 1 : 0;

    dataset.push({ features, label });
  }

  const safeCount = dataset.filter(d => d.label === 0).length;
  const tamperedCount = dataset.filter(d => d.label === 1).length;

  console.log(`📊 Dataset Generated: SAFE=${safeCount}, TAMPERED=${tamperedCount}`);

  return dataset;
};
