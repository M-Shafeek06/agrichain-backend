const Produce = require("../models/Produce");

/* =========================================================
   📊 GET AVERAGE INTEGRITY ONLY
========================================================= */
async function getAverageIntegrity(req, res) {
    try {
        const produces = await Produce.find(
            {},
            "integrityStatus integrityScore"
        ).lean();

        const total = produces.length;

        if (total === 0) {
            return res.status(200).json({
                averageIntegrityScore: 0
            });
        }

        let integritySum = 0;

        for (const p of produces) {
            if (typeof p.integrityScore === "number") {
                integritySum += p.integrityScore;
            } else if (p.integrityStatus === "TAMPERED") {
                integritySum += 0;
            } else {
                integritySum += 100;
            }
        }

        const averageIntegrityScore = Math.round(
            integritySum / total
        );

        return res.status(200).json({
            averageIntegrityScore
        });

    } catch (err) {
        console.error("AVERAGE INTEGRITY ERROR:", err);
        return res.status(500).json({
            message: "Failed to calculate average integrity"
        });
    }
}

module.exports = {
    getAverageIntegrity
};
