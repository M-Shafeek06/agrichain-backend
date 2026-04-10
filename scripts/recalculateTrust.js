const mongoose = require("mongoose");
require("dotenv").config();
const TrustScore = require("../src/models/TrustScore");

/* ================= CONNECT DB ================= */
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ DB Connected"))
    .catch(err => console.error("DB Error:", err));

/* ================= RECALCULATE ================= */
async function recalculateTrust() {
    try {
        const all = await TrustScore.find();

        console.log(`🔄 Recalculating ${all.length} records...\n`);

        for (const trust of all) {

            const successRate =
                trust.totalBlocks > 0
                    ? trust.validBlocks / trust.totalBlocks
                    : 0;

            const experienceWeight = Math.min(trust.totalBlocks / 10, 1);

            let trustScore =
                successRate * 100 * (0.5 + 0.5 * experienceWeight);

            /* 🔥 ROLE WEIGHT */
            let roleWeight = 1;

            if (trust.role === "DISTRIBUTOR") roleWeight = 1.1;
            else if (trust.role === "TRANSPORTER") roleWeight = 1.0;
            else if (trust.role === "RETAILER") roleWeight = 0.95;
            else if (trust.role === "FARMER") roleWeight = 0.9;

            trustScore = trustScore * roleWeight;

            trust.trustScore = Math.max(
                0,
                Math.min(100, Math.round(trustScore))
            );

            await trust.save();

            console.log(
                `✔ ${trust.role} (${trust.roleId}) → ${trust.trustScore}`
            );
        }

        console.log("\n🎯 Recalculation completed!");
        process.exit();

    } catch (err) {
        console.error("❌ Error:", err);
        process.exit(1);
    }
}

recalculateTrust();