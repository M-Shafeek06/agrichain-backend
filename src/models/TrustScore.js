const mongoose = require("mongoose");

const trustScoreSchema = new mongoose.Schema(
  {
    roleId: {
      type: String,
      required: false,
      index: true
    },

    role: {
      type: String,
      required: true
    },

    entityName: {
      type: String,
      default: null
    },

    trustScore: {
      type: Number,
      default: 50,
      min: 0,
      max: 100
    },

    totalBlocks: {
      type: Number,
      default: 0
    },

    validBlocks: {
      type: Number,
      default: 0
    },

    history: {
      type: [
        {
          delta: Number,
          reason: String,
          batchId: String,
          at: {
            type: Date,
            default: Date.now
          }
        }
      ],
      default: []
    }
  },
  {
    timestamps: true
  }
);

// ✅ ADD THIS
trustScoreSchema.index({ roleId: 1, role: 1 }, { unique: true });

module.exports = mongoose.model("TrustScore", trustScoreSchema);