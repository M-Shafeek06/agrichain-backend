const trainModel = require("./trainModel");

let isTraining = false;

async function runMLTraining(reason = "MANUAL") {
    if (isTraining) {
        console.log("⏳ ML training already in progress, skipping...");
        return;
    }

    isTraining = true;
    console.log(`🔁 ML Training started [${reason}]`);

    try {
        await trainModel(); // trainModel already handles DB connection
        console.log("✅ ML Training finished successfully");
    } catch (err) {
        console.error("❌ ML Training failed:", err.message);
    } finally {
        isTraining = false;
    }
}

module.exports = { runMLTraining };
