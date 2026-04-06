const mongoose = require("mongoose");

const integritySchema = new mongoose.Schema(
  {
    /* ================= CORE (EXISTING – UNCHANGED) ================= */
    batchId: {
      type: String,
      required: true,
      index: true
    },

    integrityScore: {
      type: Number,
      required: true
    },

    isTampered: {
      type: Boolean,
      default: false
    },

    verifiedAt: {
      type: Date,
      default: Date.now
    },

    hashMismatch: {
      type: Boolean,
      default: false
    },

    editCount: {
      type: Number,
      default: 0
    },

    /* ================= EXTENDED (NEW – OPTIONAL) ================= */

    // What triggered this log
    action: {
      type: String,
      default: "QR_VERIFY", // QR_VERIFY | ADMIN_VERIFY | SYSTEM_CHECK
      index: true
    },

    // AUTHENTIC / TAMPERED (derived, not canonical)
    integrityStatus: {
      type: String,
      enum: ["AUTHENTIC", "TAMPERED"],
      default: "AUTHENTIC"
    },

    // Risk label (UI / AI explanation)
    tamperRisk: {
      type: String,
      enum: ["NONE", "LOW", "MEDIUM", "HIGH"],
      default: "NONE"
    },

    // Who performed the verification
    verifiedBy: {
      type: String,
      default: "PUBLIC_QR" // PUBLIC_QR | ADMIN | SYSTEM
    },

    // AI / ML metadata
    aiTamperProbability: {
      type: Number,
      min: 0,
      max: 100
    },

    confidenceLevel: {
      type: String,
      enum: [
        "SAFE",
        "MODERATE",
        "CRITICAL",
        "FINAL",
        "BLOCKCHAIN OVERRIDE",
        "ADMIN_DECISION" // ✅ ADD THIS
      ]
    },

    // Optional context (future-proofing)
    meta: {
      type: Object,
      default: {}
    }
  },
  {
    timestamps: true // createdAt, updatedAt
  }
);

/* ================= INDEXES ================= */
integritySchema.index({ batchId: 1, createdAt: -1 });

module.exports = mongoose.model("IntegrityLog", integritySchema);
