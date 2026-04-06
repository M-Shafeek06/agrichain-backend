const { verifyBatch } = require("../controllers/verifyController");


exports.publicVerify = async (req, res) => {
    try {
        const { batchId } = req.params;

        if (!batchId) {
            return res.status(400).json({ status: "INVALID" });
        }

        const result = await verifyBatch(batchId);

        if (!result || result.status === "INVALID") {
            return res.status(404).json({ status: "INVALID" });
        }

        return res.status(200).json({
            status: result.status,
            integrityStatus: result.integrityStatus,
            integrityScore: result.integrityScore,
            tamperRisk: result.tamperRisk,
            confidenceLevel: result.confidenceLevel,
            productDetails: result.productDetails,
            supplyChainHistory: result.supplyChainHistory,
            verifiedAt: result.verifiedAt
        });

    } catch (err) {
        console.error("PUBLIC VERIFY ERROR:", err);
        return res.status(500).json({ status: "ERROR" });
    }
};
