const mongoose = require("mongoose");

const RetailerRequestSchema = new mongoose.Schema(
    {
        requestId: {
            type: String,
            unique: true,
            required: true,
            index: true
        },

        retailerId: {
            type: String,
            required: true,
            index: true
        },

        retailerName: {
            type: String,
            required: true
        },

        distributorId: {
            type: String,
            required: true,
            index: true
        },

        distributorName: {
            type: String,
            required: true
        },

        batchId: {
            type: String,
            required: true,
            index: true
        },

        cropName: {
            type: String,
            required: true
        },

        requestedQty: {
            type: Number,
            required: true,
            min: 1
        },

        invoiceId: {
            type: String,
            index: true
        },

        status: {
            type: String,
            enum: [
                "REQUESTED",
                "APPROVED",
                "DISPATCHED",
                "REJECTED",
                "DELIVERED"
            ],
            default: "REQUESTED",
            index: true
        },

        recorded: {                 // 🔥 ADD THIS
            type: Boolean,
            default: false,
            index: true
        }
    },
    {
        timestamps: true
    }
);

/* 🔹 Auto request ID generator */

RetailerRequestSchema.pre("validate", function () {
    if (!this.requestId) {
        this.requestId =
            "REQ-" +
            Math.random().toString(36).substring(2, 8).toUpperCase();
    }
});

module.exports = mongoose.model(
    "RetailerRequest",
    RetailerRequestSchema
);
