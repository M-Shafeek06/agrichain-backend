const express = require("express");
const router = express.Router();
const TrustScore = require("../models/TrustScore");

/* =========================================================
   👨‍🌾 FARMER TRUST (AUTO-CREATE SAFE)
   ========================================================= */
router.get("/farmer/:farmerId", async (req, res) => {
    try {
        const { farmerId } = req.params;

        let trust = await TrustScore.findOne({
            roleId: farmerId,
            role: "FARMER"
        });

        // 🔥 Auto-create if missing (safe & non-breaking)
        if (!trust) {
            trust = await TrustScore.create({
                roleId: farmerId,
                role: "FARMER",
                trustScore: 50,   // neutral baseline
                totalBlocks: 0,
                validBlocks: 0
            });
        }

        return res.json({
            trustScore: trust.trustScore ?? 0,
            totalBlocks: trust.totalBlocks ?? 0,
            validBlocks: trust.validBlocks ?? 0,
            lastUpdated: trust.updatedAt ?? null
        });

    } catch (err) {
        console.error("Farmer trust fetch error:", err.message);
        return res.status(500).json({
            error: "Farmer trust fetch failed"
        });
    }
});


/* =========================================================
   🏪 RETAILER TRUST
   ========================================================= */
router.get("/retailer/:retailerId", async (req, res) => {
    try {
        const { retailerId } = req.params;

        const trust = await TrustScore.findOne(
            { roleId: retailerId, role: "RETAILER" },
            {
                trustScore: 1,
                totalBlocks: 1,
                validBlocks: 1,
                updatedAt: 1,
                _id: 0
            }
        ).lean();

        if (!trust) {
            return res.json({
                trustScore: 0,
                totalBlocks: 0,
                validBlocks: 0,
                lastUpdated: null
            });
        }

        return res.json({
            trustScore: trust.trustScore ?? 0,
            totalBlocks: trust.totalBlocks ?? 0,
            validBlocks: trust.validBlocks ?? 0,
            lastUpdated: trust.updatedAt ?? null
        });

    } catch (err) {
        console.error("Retailer trust fetch error:", err.message);
        return res.status(500).json({
            error: "Retailer trust fetch failed"
        });
    }
});


/* =========================================================
   🔎 GENERIC TRUST FETCH (TRANSPORTER / ADMIN / OTHERS)
   IMPORTANT: This MUST be last
   ========================================================= */
router.get("/:roleId", async (req, res) => {
    try {
        const { roleId } = req.params;

        const trust = await TrustScore.findOne(
            { roleId },
            {
                trustScore: 1,
                totalBlocks: 1,
                validBlocks: 1,
                updatedAt: 1,
                _id: 0
            }
        ).lean();

        if (!trust) {
            return res.json({
                trustScore: 0,
                totalBlocks: 0,
                validBlocks: 0,
                lastUpdated: null
            });
        }

        return res.json({
            trustScore: trust.trustScore ?? 0,
            totalBlocks: trust.totalBlocks ?? 0,
            validBlocks: trust.validBlocks ?? 0,
            lastUpdated: trust.updatedAt ?? null
        });

    } catch (err) {
        console.error("Trust fetch error:", err.message);
        return res.status(500).json({
            error: "Trust fetch failed"
        });
    }
});

module.exports = router;
