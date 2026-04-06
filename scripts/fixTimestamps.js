const mongoose = require("mongoose");
const Shipment = require("../src/models/Shipment");
require("dotenv").config();

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const records = await Shipment.find();

  for (const r of records) {
    if (!r.createdAt) {
      r.createdAt = new Date();
      await r.save();
    }
  }

  console.log("✔ Shipment timestamps repaired");
  process.exit();
})();
