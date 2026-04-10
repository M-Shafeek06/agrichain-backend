const TrustScore = require("../models/TrustScore");
const RoleIdentity = require("../models/RoleIdentity");

module.exports = async function updateTrustScore({
    role, // not used intentionally (DB is source of truth)
    roleId,
    entityName,
    isValid,
    batchId,
    reason
}) {
    try {
        if (!roleId) {
            console.warn("Trust update skipped: missing roleId");
            return;
        }

        /* 🔥 STEP 1: FETCH TRUE ROLE */
        const identity = await RoleIdentity.findOne({ roleId }).lean();

        if (!identity) {
            console.warn("Trust update skipped: invalid roleId");
            return;
        }

        const correctRole = identity.role;
        const correctName = identity.name || entityName || null;

        /* 🔥 STEP 2: FIND OR CREATE */
        let trust = await TrustScore.findOne({ roleId });

        if (!trust) {
            trust = new TrustScore({
                role: correctRole,
                roleId,
                entityName: correctName,
                trustScore: 50,
                totalBlocks: 0,
                validBlocks: 0,
                history: []
            });
        }

        /* 🔥 STEP 3: AUTO-CORRECT ROLE */
        if (trust.role !== correctRole) {
            trust.role = correctRole;
        }

        if (!trust.entityName && correctName) {
            trust.entityName = correctName;
        }

        /* 🚫 DUPLICATE EVENT GUARD (CRITICAL FIX) */
        const alreadyLogged = trust.history.some(
            h => h.batchId === batchId && h.delta === (isValid ? 1 : -1)
        );

        if (alreadyLogged) {
            return; // 🔥 STOP SPAM
        }

        /* 🔥 STEP 4: UPDATE COUNTERS */
        trust.totalBlocks += 1;

        if (isValid === true) {
            trust.validBlocks += 1;
        }

        /* =====================================================
           🔥 STEP 5: NEW TRUST FORMULA (FINAL FIX)
        ===================================================== */

        const successRate =
            trust.totalBlocks > 0
                ? trust.validBlocks / trust.totalBlocks
                : 0;

        // Experience factor (more blocks = more trust weight)
        const experienceWeight = Math.min(trust.totalBlocks / 20, 1);

        let trustScore =
            successRate * 100 * (0.5 + 0.5 * experienceWeight);

        /* 🔥 ROLE-BASED WEIGHTING */
        let roleWeight = 1;

        if (correctRole === "DISTRIBUTOR") roleWeight = 1.1;
        else if (correctRole === "TRANSPORTER") roleWeight = 1.0;
        else if (correctRole === "RETAILER") roleWeight = 0.95;
        else if (correctRole === "FARMER") roleWeight = 0.9;

        trustScore = trustScore * roleWeight;

        /* 🔒 CLAMP 0–100 */
        trust.trustScore = Math.max(
            0,
            Math.min(100, Math.round(trustScore))
        );

        /* 🔥 STEP 6: HISTORY */
        trust.history.push({
            delta: isValid ? +1 : -1,
            reason,
            batchId,
            at: new Date()
        });

        await trust.save();

    } catch (err) {
        console.error("Trust update error:", err.message);
    }
};