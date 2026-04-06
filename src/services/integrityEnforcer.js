const Produce = require("../models/Produce");
const IntegrityLog = require("../models/IntegrityLog");
const { verifyBatch } = require("./verificationService");

async function enforceIntegrity(batchId) {

    const produce = await Produce.findOne({ batchId });
    if (!produce) {
        return { status: "INVALID" };
    }

    /* =====================================================
       🛡 HARD PROTECTION: VERIFIED BATCHES ARE IMMUTABLE
       ===================================================== */
    if (produce.status === "VERIFIED") {
        const result = await verifyBatch(batchId);

        return {
            ...result,
            status: "AUTHENTIC",
            integrityScore: 100,
            tamperRisk: "LOW",
            confidenceLevel: "SAFE",
            note: "Batch already admin-verified. Integrity locked."
        };
    }

    // 🔒 HARD STOP: already tampered → read-only verify
    if (produce.integrityStatus === "TAMPERED") {
        return await verifyBatch(batchId);
    }

    // 🧪 Run forensic verification (READ-ONLY)
    const result = await verifyBatch(batchId);
    if (result.status === "INVALID") return result;

    /* =====================================================
       🚫 BLOCKCHAIN UNAVAILABLE → DO NOTHING
       ===================================================== */
    if (
        result.aiExplainability &&
        result.aiExplainability.blockchainHashMatched === false &&
        result.aiExplainability.hashMismatch === false
    ) {
        // Verification inconclusive — DO NOT downgrade integrity
        return result;
    }

    /* =====================================================
       ✅ INITIAL AUTHENTIC LOG (ONCE)
       ===================================================== */
    if (result.integrityScore === 100) {
        await IntegrityLog.updateOne(
            { batchId, integrityScore: 100 },
            {
                $setOnInsert: {
                    batchId,
                    integrityScore: 100,
                    isTampered: false,
                    hashMismatch: false,
                    editCount: 1,
                    verifiedAt: new Date()
                }
            },
            { upsert: true }
        );
    }

    /* =====================================================
       🔥 REAL TAMPER ONLY (BLOCKCHAIN PROVEN)
       ===================================================== */
    if (
        result.integrityScore === 0 &&
        result.aiExplainability &&
        result.aiExplainability.blockchainHashMatched === false
    ) {

        await Produce.updateOne(
            { batchId, integrityStatus: { $ne: "TAMPERED" } },
            {
                $set: {
                    integrityStatus: "TAMPERED",
                    integrityScore: 0
                }
            }
        );

        const previousCount = await IntegrityLog.countDocuments({ batchId });

        await IntegrityLog.updateOne(
            { batchId, integrityScore: 0 },
            {
                $setOnInsert: {
                    batchId,
                    event: "BLOCKCHAIN HASH MISMATCH",
                    status: "TAMPERED",
                    integrityScore: 0,
                    isTampered: true,
                    hashMismatch: true,
                    editCount: previousCount + 1,
                    evidence: result.tamperedDetails,
                    verifiedAt: new Date()
                }
            },
            { upsert: true }
        );
    }

    return result;
}

module.exports = { enforceIntegrity };
