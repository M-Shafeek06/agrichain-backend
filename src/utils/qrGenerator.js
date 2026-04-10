const QRCode = require("qrcode");

const BASE_URL =
  process.env.FRONTEND_URL || "http://localhost:5173"; // fallback for dev

exports.generateBatchQR = async (batchId) => {
  const verifyURL = `${BASE_URL}/produce/view/${batchId}`;

  return await QRCode.toDataURL(verifyURL, {
    errorCorrectionLevel: "H",
    type: "image/png",
    width: 300,
    margin: 2
  });
};

exports.generateAllocationQR = async (inventoryId) => {
  const verifyURL = `${BASE_URL}/verify/${inventoryId}`;

  return await QRCode.toDataURL(verifyURL, {
    errorCorrectionLevel: "H",
    type: "image/png",
    width: 300,
    margin: 2
  });
};