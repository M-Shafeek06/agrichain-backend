const mongoose = require("mongoose");
const Shipment = require("../src/models/Shipment");
require("dotenv").config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected");

    const records = await Shipment.find();

    for (const r of records) {
      if (!r.createdAt && r.timestamp) {
        r.createdAt = new Date(r.timestamp);
        await r.save();
      }
    }

    console.log("✔ Shipment timestamp repair completed");
    process.exit();
  } catch (err) {
    console.error("Repair failed:", err.message);
    process.exit(1);
  }
})();
