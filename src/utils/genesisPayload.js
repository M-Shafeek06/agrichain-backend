module.exports = function buildGenesisPayload(produce) {
  return {
    batchId: produce.batchId,
    farmerId: produce.farmerId,
    farmerName: produce.farmerName,
    cropName: produce.cropName,
    quantity: Number(produce.quantity),
    qualityGrade: produce.qualityGrade,
    harvestDate: new Date(produce.harvestDate).toISOString(),
    ipfsHash: produce.ipfsHash || "",        // 🔥 CRITICAL FIX
    shipments: []
  };
};
