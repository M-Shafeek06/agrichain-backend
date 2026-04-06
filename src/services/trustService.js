const TrustScore = require("../models/TrustScore");

exports.updateTrust = async (
  roleId,
  entityName,
  role,
  isValid,
  reason,
  batchId
) => {
  try {
    let record = await TrustScore.findOne({ roleId, role });

    if (!record) {
      record = new TrustScore({
        roleId,
        entityName,
        role,
        totalBlocks: 0,
        validBlocks: 0,
        trustScore: 50,
        history: []
      });
    }

    // 🔹 Update blocks
    record.totalBlocks += 1;

    if (isValid) {
      record.validBlocks += 1;
    }

    // 🔹 Recalculate trust
    record.trustScore = Math.round(
      (record.validBlocks / record.totalBlocks) * 100
    );

    // 🔹 Push history
    record.history.push({
      delta: isValid ? 1 : -1,
      reason,
      batchId
    });

    await record.save();

  } catch (err) {
    console.error("Trust Service Error:", err.message);
    throw err;
  }
};