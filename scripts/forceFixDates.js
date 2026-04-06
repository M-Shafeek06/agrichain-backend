const mongoose = require("mongoose");
const Shipment = require("../src/models/Shipment");
require("dotenv").config();

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("Mongo connected");

    const shipments = await Shipment.find();

    for (const s of shipments) {
      if (!s.createdAt || isNaN(new Date(s.createdAt))) {
        // fallback: use _id timestamp
        const objectTime = new Date(parseInt(s._id.toString().substring(0, 8), 16) * 1000);
        s.createdAt = objectTime;
        await s.save();
      }
    }

    console.log("✔ FORCE date repair completed");
    process.exit();
  } catch (err) {
    console.error("FAILED:", err.message);
    process.exit(1);
  }
})();
