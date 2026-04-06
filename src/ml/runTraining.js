require("dotenv").config();
const mongoose = require("mongoose");
const trainModel = require("./trainModel");

(async () => {
    try {
        console.log("🔁 Manual ML training started...");

        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ MongoDB connected for ML training");

        await trainModel();

        await mongoose.disconnect();
        console.log("🔌 MongoDB disconnected");
        process.exit(0);

    } catch (err) {
        console.error("❌ Manual ML training failed:", err.message);
        process.exit(1);
    }
})();
