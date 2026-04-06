const mongoose = require("mongoose");

const retailerInventorySchema = new mongoose.Schema(
    {
        inventoryId: {
            type: String,
            unique: true,
            required: true
        },

        retailerId: {
            type: String,
            required: true,
            index: true
        },

        batchId: {
            type: String,
            required: true
        },

        invoiceId: {
            type: String,
            required: true,
            index: true
        },

        quantity: {
            type: Number,
            required: true,
            min: 0
        },

        dispatchCost: {
            type: Number,
            required: true
        },

        transportCharge: {
            type: Number,
            required: true
        },

        retailerPerKgPrice: {
            type: Number,
            required: true
        },

        remainingQuantity: {
            type: Number,
            required: true,
            min: 0
        },

        soldQuantity: {
            type: Number,
            default: 0,
            min: 0
        },

        /* 🔥 NEW: Allocation Hash (Blockchain Anchored) */
        allocationHash: {
            type: String,
            required: true
        },

        allocationTimestamp: {
            type: Number,
            required: true
        },

        allocationQR: {
            type: String
        },

        sourceShipment: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Shipment",
            required: true
        },

        status: {
            type: String,
            enum: ["available", "sold_out"],
            default: "available"
        },

        integrityStatus: {
            type: String,
            enum: ["AUTHENTIC", "TAMPERED"],
            default: "AUTHENTIC"
        },

        integrityHash: {
            type: String
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model(
    "RetailerInventory",
    retailerInventorySchema
);