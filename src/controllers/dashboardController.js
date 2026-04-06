const Produce = require("../models/Produce");
const Shipment = require("../models/Shipment");
const TrustScore = require("../models/TrustScore");
const RoleIdentity = require("../models/RoleIdentity");

/**
 * 📊 MAIN ANALYTICS DASHBOARD
 * ✅ TRUSTS STORED FORENSIC STATE
 * ❌ NEVER RECOMPUTES HASH
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const produces = await Produce.find(
      {},
      "batchId farmerName integrityStatus integrityScore createdAt updatedAt verificationStatus"
    ).lean();

    let verifiedBatches = 0;
    let tamperedBatches = 0;
    let integritySum = 0;
    let integrityCount = 0;

    const integrityTrend = [];

    for (const p of produces) {
      // ✅ Canonical classification
      if (p.integrityStatus === "TAMPERED") {
        tamperedBatches++;
      }

      if (
        p.integrityStatus === "AUTHENTIC" &&
        p.verificationStatus === "APPROVED"
      ) {
        verifiedBatches++;
      }

      // ✅ Avg integrity only from AUTHENTIC records
      if (
        p.integrityStatus === "AUTHENTIC" &&
        typeof p.integrityScore === "number"
      ) {
        integritySum += p.integrityScore;
        integrityCount++;
      }

      integrityTrend.push({
        date: p.updatedAt || p.createdAt,
        integrityScore:
          p.integrityStatus === "AUTHENTIC" ? p.integrityScore : 0
      });
    }

    const totalBatches = produces.length;

    const averageIntegrityScore =
      integrityCount > 0
        ? Math.round(integritySum / integrityCount)
        : 0;

    /* ========= RECENT ACTIVITY ========= */
    let recentActivities = await Shipment.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select("batchId handlerName status createdAt")
      .lean();

    // 🔁 Fallback to Produce lifecycle (READ-ONLY)
    if (recentActivities.length === 0) {
      recentActivities = produces
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt) -
            new Date(a.updatedAt || a.createdAt)
        )
        .slice(0, 5)
        .map(p => ({
          batchId: p.batchId,
          handlerName: p.farmerName || "System",
          status: p.verificationStatus || "PENDING",
          createdAt: p.updatedAt || p.createdAt
        }));
    }

    /* ========= MONTHLY ACTIVITY ========= */
    const monthlyStats = await Produce.aggregate([
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            year: { $year: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": -1, "_id.month": -1 } },
      { $limit: 6 },
      {
        $project: {
          _id: 0,
          month: {
            $arrayElemAt: [
              [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
              ],
              { $subtract: ["$_id.month", 1] }
            ]
          },
          count: 1
        }
      }
    ]);

    /* ========= ROLE DISTRIBUTION ========= */
    let roleDistribution = [];

    try {
      roleDistribution = await RoleIdentity.aggregate([
        {
          $group: {
            _id: "$role",
            count: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            role: "$_id",
            count: 1
          }
        }
      ]);
    } catch (err) {
      console.warn("Role distribution skipped:", err.message);
    }

    return res.status(200).json({
      totalBatches,
      verifiedBatches,
      tamperedBatches,
      averageIntegrityScore,
      integrityTrend,
      recentActivities,
      monthlyStats,
      roleDistribution
    });

  } catch (error) {
    console.error("Dashboard Error:", error.message);
    return res.status(500).json({
      message: "Dashboard analytics failed",
      error: error.message
    });
  }
};

/**
 * 🚦 TRUST LEADERBOARD (SAFE + FALLBACK)
 */
/**
 * 🚦 TRUST LEADERBOARD
 * ✅ FETCHES ONLY FROM DATABASE
 * ❌ NO FALLBACK / NO DERIVED VALUES
 */
exports.getTrustLeaderboard = async (req, res) => {
  try {
    const leaderboard = await TrustScore.find(
      { trustScore: { $gt: 0 } }, // only valid trust entries
      {
        _id: 0,
        role: 1,
        entityName: 1,
        trustScore: 1
      }
    )
      .sort({ trustScore: -1 })
      .limit(5)
      .lean();

    return res.status(200).json(leaderboard);

  } catch (error) {
    console.error("Trust Leaderboard Error:", error.message);
    return res.status(500).json({
      message: "Trust leaderboard fetch failed",
      error: error.message
    });
  }
};