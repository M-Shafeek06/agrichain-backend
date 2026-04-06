const QRCode = require("qrcode");

exports.generateBatchQR = async (batchId) => {
  const verifyURL = `http://localhost:5173/produce/view/${batchId}`;

  return await QRCode.toDataURL(verifyURL, {
    errorCorrectionLevel: "H",
    type: "image/png",
    width: 300,
    margin: 2
  });
};

exports.generateAllocationQR = async (inventoryId) => {
  const verifyURL = `http://localhost:5173/produce/allocation/${inventoryId}`;

  return await QRCode.toDataURL(verifyURL, {
    errorCorrectionLevel: "H",
    type: "image/png",
    width: 300,
    margin: 2
  });
};