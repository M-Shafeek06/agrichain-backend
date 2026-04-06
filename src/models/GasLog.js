const mongoose = require("mongoose");

const GasLogSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, index: true },
    txHash: { type: String, required: true },
    gasUsed: { type: Number, required: true },
    operation: { type: String, default: "STORE_HASH" } // future proof
  },
  { timestamps: true }
);

module.exports = mongoose.model("GasLog", GasLogSchema);
