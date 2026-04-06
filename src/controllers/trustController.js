const TrustScore = require("../models/TrustScore");

/* =========================================================
   👤 GET TRUST SCORE BY ROLE ID (PROFILE SETTINGS)
   ========================================================= */
exports.getTrustScoreByRoleId = async (req, res) => {
    try {
        const { roleId } = req.params;

        if (!roleId) {
            return res.status(200).json({ trustScore: 0 });
        }

        const trust = await TrustScore.findOne(
            { roleId },
            { trustScore: 1, _id: 0 }
        ).lean();

        return res.status(200).json({
            trustScore: trust?.trustScore ?? 0
        });

    } catch (err) {
        console.error("TRUST SCORE FETCH ERROR:", err.message);
        return res.status(200).json({ trustScore: 0 });
    }
};

/* =========================================================
   🏆 TRUST LEADERBOARD (ADMIN DASHBOARD)
   ========================================================= */
exports.getTrustLeaderboard = async (req, res) => {
    try {
        const leaderboard = await TrustScore.find(
            { entityName: { $ne: null } },
            { entityName: 1, trustScore: 1, role: 1, _id: 0 }
        )
            .sort({ trustScore: -1 })
            .limit(10)
            .lean();

        return res.status(200).json(leaderboard);

    } catch (err) {
        console.error("TRUST LEADERBOARD ERROR:", err.message);
        return res.status(500).json({
            message: "Trust leaderboard fetch failed"
        });
    }
};
