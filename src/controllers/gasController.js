const GasLog = require("../models/GasLog");

exports.getGasStats = async (req, res) => {
  try {

    /* ===============================
       1️⃣ Aggregate Statistics
    =============================== */
    const statsResult = await GasLog.aggregate([
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          averageGas: { $avg: "$gasUsed" },
          maxGas: { $max: "$gasUsed" },
          minGas: { $min: "$gasUsed" }
        }
      }
    ]);

    const stats = statsResult[0] || {
      totalTransactions: 0,
      averageGas: 0,
      maxGas: 0,
      minGas: 0
    };

    /* ===============================
       2️⃣ Fetch Recent Transactions
       (Only required fields)
    =============================== */
    const recent = await GasLog.find()
      .sort({ createdAt: -1 })
      .select("batchId txHash gasUsed operation createdAt")
      .lean();

    /* ===============================
       3️⃣ Send Clean Response
    =============================== */
    res.json({
      totalTransactions: stats.totalTransactions,
      averageGas: Math.round(stats.averageGas || 0),
      maxGas: stats.maxGas || 0,
      minGas: stats.minGas || 0,
      recent
    });

  } catch (err) {
    console.error("Gas Stats Error:", err);
    res.status(500).json({
      message: "Failed to load gas stats"
    });
  }
};