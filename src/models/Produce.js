const mongoose = require("mongoose");

/* =========================================================
PRODUCE STATE MACHINE (FINAL STABLE VERSION)
========================================================= */

const PRODUCE_STATES = [
  "CREATED_BY_FARMER",
  "VERIFIED_BY_ADMIN",
  "IN_TRANSPORT_TO_DISTRIBUTOR",
  "OWNED_BY_DISTRIBUTOR",
  "RETAILER_REQUESTED",
  "IN_TRANSPORT_TO_RETAILER",
  "DELIVERED_TO_RETAILER",
  "OWNED_BY_RETAILER",
  "PARTIALLY_SOLD",
  "SOLD"
];

const VALID_TRANSITIONS = {
  CREATED_BY_FARMER: ["VERIFIED_BY_ADMIN"],

  VERIFIED_BY_ADMIN: [
    "IN_TRANSPORT_TO_DISTRIBUTOR",
    "OWNED_BY_DISTRIBUTOR"
  ],

  IN_TRANSPORT_TO_DISTRIBUTOR: [
    "OWNED_BY_DISTRIBUTOR"
  ],

  OWNED_BY_DISTRIBUTOR: [
    "READY_FOR_DISPATCH",
    "RETAILER_REQUESTED",
    "IN_TRANSPORT_TO_RETAILER" // ✅ ADD THIS
  ],

  RETAILER_REQUESTED: [
    "IN_TRANSPORT_TO_RETAILER",
    "OWNED_BY_DISTRIBUTOR"
  ],

  IN_TRANSPORT_TO_RETAILER: [
    "DELIVERED_TO_RETAILER"
  ],

  DELIVERED_TO_RETAILER: [
    "OWNED_BY_RETAILER",
    "OWNED_BY_DISTRIBUTOR"
  ],

  OWNED_BY_RETAILER: [
    "PARTIALLY_SOLD",
    "SOLD"
  ],

  PARTIALLY_SOLD: [
    "PARTIALLY_SOLD",
    "SOLD"
  ],

  SOLD: []
};

/* =========================================================
SCHEMA
========================================================= */

const ProduceSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true
    },

    farmerId: {
      type: String,
      required: true,
      index: true
    },

    distributorId: {
      type: String,
      default: null,
      index: true
    },

    requestedRetailerId: {
      type: String,
      default: null,
      index: true
    },

    farmerName: {
      type: String,
      required: true,
      trim: true
    },

    cropName: {
      type: String,
      required: true,
      trim: true
    },

    quantity: {
      type: Number,
      required: true,
      min: 1
    },

    /* ================= MASTER STATE ================= */

    state: {
      type: String,
      enum: PRODUCE_STATES,
      default: "CREATED_BY_FARMER",
      index: true
    },

    currentOwnerRole: {
      type: String,
      enum: ["FARMER", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"],
      default: "FARMER"
    },

    currentOwnerId: {
      type: String,
      default: null,
      index: true
    },

    /* ================= INVENTORY ================= */

    totalQuantity: {
      type: Number
    },

    reservedQuantity: {
      type: Number,
      default: 0,
      min: 0
    },

    soldQuantity: {
      type: Number,
      default: 0,
      min: 0
    },

    remainingQuantity: {
      type: Number
    },

    inTransitQuantity: {
      type: Number,
      default: 0
    },

    salesLog: [
      {
        quantity: {
          type: Number,
          required: true,
          min: 1
        },
        soldAt: {
          type: Date,
          default: Date.now
        },
        retailerId: String
      }
    ],

    qualityGrade: {
      type: String,
      enum: ["A", "B", "C"],
      required: true
    },

    basePrice: {
      type: Number,
      default: null
    },

    priceAssignedBy: {
      type: String,
      default: null
    },

    priceAssignedAt: {
      type: Date,
      default: null
    },

    harvestDate: {
      type: Date,
      required: true
    },

    shipmentCount: {
      type: Number,
      default: 0
    },

    editCount: {
      type: Number,
      default: 0
    },

    integrityScore: Number,
    ipfsHash: String,

    genesisHash: {
      type: String,
      default: null,        // ✅ allow creation without hash
      immutable: true       // ✅ once set (at approval), cannot be changed
    },

    originalSnapshot: {
      type: Object,
      default: null,        // ✅ allow creation without snapshot
    },

    integrityStatus: {
      type: String,
      enum: [
        "UNVERIFIED",
        "AUTHENTIC",
        "PARTIALLY_TAMPERED",
        "TAMPERED"
      ],
      default: "UNVERIFIED",
      index: true
    },

    verificationStatus: {
      type: String,
      enum: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "INVALIDATED"
      ],
      default: "PENDING",
      index: true
    },

    distributorAcceptedBasePrice: {
      type: Number,
      default: null
    },

    distributorAcceptedAt: {
      type: Date,
      default: null
    },

    tamperExplanation: {
      type: String,
      default: ""
    },

    arrivedAtDistributor: {
      type: Boolean,
      default: false
    },

    distributorProfit: {
      type: Number,
      default: 0
    },

    tamperedAtRole: String,
    tamperedAtId: String,

    verifiedBy: String,
    verifiedAt: Date,
    adminRemark: {
      type: String,
      default: ""
    },

    transporterInvoice: Object,

    transported: {
      type: Boolean,
      default: false
    },

    initialTransportCost: {
      type: Number,
      default: 0
    },

    distributorTotalCost: {
      type: Number,
      default: 0
    },

    costLocked: {
      type: Boolean,
      default: false
    }
  },

  {
    timestamps: true,
    collection: "produces"
  }
);

/* =========================================================
PRE-SAVE VALIDATION ENGINE
========================================================= */

ProduceSchema.pre("save", async function () {
  const Produce = mongoose.model("Produce");

  /* ---------- INIT NEW DOCUMENT ---------- */

  if (this.isNew) {
    this.totalQuantity ??= this.quantity;
    this.remainingQuantity ??= this.quantity;
    this.soldQuantity ??= 0;

    // 🔥 FIX: Ensure farmer is initial owner
    this.currentOwnerRole = "FARMER";
    this.currentOwnerId = this.farmerId;

    return;
  }

  /* ---------- FETCH PREVIOUS ---------- */

  const previousDoc = await Produce.findById(this._id).lean();

  /* ---------- STATE TRANSITION VALIDATION ---------- */

  if (this.isModified("state")) {
    const prevState = previousDoc?.state;

    if (
      prevState &&
      !VALID_TRANSITIONS[prevState]?.includes(this.state)
    ) {
      throw new Error(
        `Invalid state transition: ${prevState} To ${this.state}`
      );
    }
  }

  /* ---------- OWNERSHIP ENFORCEMENT ---------- */

  const ownerMap = {

    CREATED_BY_FARMER: ["FARMER", this.farmerId],

    VERIFIED_BY_ADMIN: ["FARMER", this.farmerId],

    OWNED_BY_DISTRIBUTOR: ["DISTRIBUTOR", this.distributorId],

    RETAILER_REQUESTED: ["DISTRIBUTOR", this.distributorId],

    IN_TRANSPORT_TO_RETAILER: ["TRANSPORTER", this.currentOwnerId],

    DELIVERED_TO_RETAILER: ["TRANSPORTER", this.currentOwnerId],

    OWNED_BY_RETAILER: ["RETAILER", this.requestedRetailerId],

    PARTIALLY_SOLD: ["RETAILER", this.requestedRetailerId],

    SOLD: ["RETAILER", this.requestedRetailerId]

  };

  if (ownerMap[this.state]) {
    const [role, id] = ownerMap[this.state];

    if (!id && role !== "ADMIN") {
      throw new Error(`Missing owner ID for ${this.state}`);
    }

    this.currentOwnerRole = role;
    this.currentOwnerId = id;
  }

  /* ---------- RETAILER REQUEST LOCK ---------- */

  if (
    previousDoc?.state === "RETAILER_REQUESTED" &&
    this.requestedRetailerId !== previousDoc.requestedRetailerId
  ) {
    throw new Error("Retailer already requested this batch");
  }

  /* ---------- INVENTORY CALCULATION ---------- */

  this.remainingQuantity =
    this.totalQuantity - this.reservedQuantity - this.soldQuantity;

  if (this.remainingQuantity < 0) {
    throw new Error("Inventory cannot go negative");
  }

  /* ---------- AUTO STATE BASED ON INVENTORY ---------- */

  if (
    this.state === "OWNED_BY_RETAILER" &&
    this.soldQuantity > 0 &&
    this.remainingQuantity > 0
  ) {
    this.state = "PARTIALLY_SOLD";
  }

  /* ---------- AUTO STATE BASED ON INVENTORY ---------- */

  if (
    this.soldQuantity === this.totalQuantity
  ) {
    this.state = "SOLD";
  }

  /* =========================================================
   🔐 ECONOMIC FIELD LOCK (FIXED FOR MULTI-TRANSPORT)
========================================================= */

  const protectedFields = [
    "distributorTotalCost",
    "initialTransportCost"
  ];

  const money = (val) => Math.round(val * 100) / 100;

  const quantity = this.totalQuantity || 0;
  const basePrice = this.basePrice || 0;

  /* 🔥 IMPORTANT FIX:
     Use ONLY distributor transport cost (session 2)
  */
  const transportCost = this.initialTransportCost || 0;

  const expectedGoodsCost = money(quantity * basePrice);
  const expectedTotalCost = money(expectedGoodsCost + transportCost);

  for (const field of protectedFields) {

    if (this.isModified(field)) {

      if (field === "distributorTotalCost") {
        if (money(this.distributorTotalCost) !== expectedTotalCost) {
          throw new Error("Tampering detected: distributorTotalCost mismatch");
        }
      }

      if (field === "initialTransportCost") {
        // ✅ ONLY ensure it's a valid positive number
        if (this.initialTransportCost < 0) {
          throw new Error("Tampering detected: invalid transport cost");
        }
      }
    }
  }

  /* ---------- EDIT TRACKING ---------- */

  const meaningfulFields = [
    "quantity",
    "cropName",
    "qualityGrade",
    "harvestDate"
  ];

  if (meaningfulFields.some((f) => this.isModified(f))) {
    this.editCount += 1;
  }
});

/* =========================================================
GENESIS LOCK
========================================================= */

ProduceSchema.pre("findOneAndUpdate", function () {
  const update = this.getUpdate() || {};

  if (
    update.genesisHash ||
    (update.$set && update.$set.genesisHash)
  ) {
    throw new Error("Genesis hash cannot be modified");
  }
});

ProduceSchema.pre("findOneAndUpdate", async function (next) {
  try {
    const update = this.getUpdate() || {};

    // Extract basePrice from different update operators
    const directBasePrice = update.basePrice;
    const setBasePrice = update.$set?.basePrice;
    const unsetBasePrice = update.$unset?.basePrice;

    const attemptingToModify =
      directBasePrice !== undefined ||
      setBasePrice !== undefined ||
      unsetBasePrice !== undefined;

    if (!attemptingToModify) {
      return next();
    }

    // Fetch existing document
    const existingDoc = await this.model
      .findOne(this.getQuery())
      .lean();

    if (!existingDoc) {
      return next();
    }

    // Allow assignment only if basePrice is currently null
    if (existingDoc.basePrice !== null && existingDoc.basePrice !== undefined) {
      return next(
        new Error("Base price cannot be modified after assignment")
      );
    }

    return next();

  } catch (err) {
    return next(err);
  }
});

/* =========================================================
   🔐 BLOCK DIRECT COST TAMPERING (ADD HERE)
========================================================= */

ProduceSchema.pre("findOneAndUpdate", async function (next) {

  const update = this.getUpdate() || {};

  const restrictedFields = [
    "distributorTotalCost",
    "initialTransportCost"
  ];

  const isTryingToModify = restrictedFields.some(field =>
    update[field] !== undefined ||
    update.$set?.[field] !== undefined
  );

  if (!isTryingToModify) return next();

  return next(new Error("Direct modification of cost fields is not allowed"));
});

/* =========================================================
MODEL EXPORT
========================================================= */

module.exports = mongoose.model("Produce", ProduceSchema);
