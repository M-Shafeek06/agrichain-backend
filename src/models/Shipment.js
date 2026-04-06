const mongoose = require("mongoose");

const SHIPMENT_STATUSES = [
  /* ---------- Transporter assignment ---------- */

  // Distributor assigns to transporter
  "ASSIGNED_TO_TRANSPORTER",

  /* ---------- Transporter flow ---------- */

  "PICKED_UP",
  "IN_TRANSIT",

  /* ---------- Arrival at distributor ---------- */

  "AT_DISTRIBUTOR",

  /* ---------- Distributor warehouse flow ---------- */

  "IN_DISTRIBUTOR_INVENTORY",
  "READY_FOR_DISPATCH",
  "DISPATCHED_TO_RETAILER",
  "REJECTED_BY_DISTRIBUTOR",

  /* ---------- Final delivery ---------- */

  "DELIVERED"
];

/* =====================================================
SCHEMA
===================================================== */

const ShipmentSchema = new mongoose.Schema(
  {
    /* ================= CORE IDENTIFIERS ================= */

    batchId: {
      type: String,
      required: true,
      index: true,
      trim: true
    },

    handlerRole: {
      type: String,
      enum: ["FARMER", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"],
      required: true,
      index: true
    },

    handlerId: {
      type: String,
      required: true,
      index: true,
      trim: true
    },

    handlerName: {
      type: String,
      required: true,
      trim: true
    },

    cropName: {
      type: String,
      trim: true
    },

    /* ================= OWNERSHIP LINKS ================= */

    distributorId: {
      type: String,
      default: null,
      index: true
    },

    retailerId: {
      type: String,
      default: null,
      index: true
    },

    /* Optional shipment session */

    shipmentSessionId: {
      type: String,
      default: null,
      index: true
    },

    transporterId: {
      type: String,
      default: null,
      index: true
    },

    invoiceId: {
      type: String,
      index: true
    },

    shipmentQuantity: {
      type: Number,
      default: 0
    },

    /* ================= MOVEMENT STATUS ================= */

    status: {
      type: String,
      enum: SHIPMENT_STATUSES,
      required: true,
      index: true
    },

    /* ================= LOCATION TRACKING ================= */

    location: {
      type: String,
      required: true,
      trim: true
    },

    lat: {
      type: Number,
      default: null
    },

    lng: {
      type: Number,
      default: null
    },

    distance: {
      type: Number,
      default: 0
    },

    /* ================= BLOCKCHAIN ================= */

    previousHash: {
      type: String,
      default: "GENESIS",
      index: true
    },

    blockHash: {
      type: String,
      required: true,
      index: true
    },

    isValid: {
      type: Boolean,
      default: true
    },

    chainValid: {
      type: Boolean,
      default: true,
      index: true
    },


    /* Snapshot cache (UI optimization) */

    latest: {
      location: String,
      lat: Number,
      lng: Number,
      status: String,
      updatedAt: Date
    }
  },
  {
    timestamps: true
  }
);

/* =====================================================
BLOCKCHAIN CHAIN VALIDATION
===================================================== */

ShipmentSchema.pre("save", async function () {
  if (!this.isNew) return;

  const prev = await mongoose
    .model("Shipment")
    .findOne({
      batchId: this.batchId
    })
    .sort({ createdAt: -1 })
    .lean();

  if (!prev && this.previousHash !== "GENESIS") {
    throw new Error("Invalid shipment chain start");
  }

  if (prev && prev.blockHash !== this.previousHash) {
    throw new Error("Shipment blockchain mismatch");
  }
});

/* =====================================================
EXPORT
===================================================== */

module.exports = mongoose.model("Shipment", ShipmentSchema);
