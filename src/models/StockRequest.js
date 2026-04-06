const mongoose = require("mongoose");

const StockRequestSchema = new mongoose.Schema(
    {
        requestId: {
            type: String,
            required: true,
            unique: true
        },

        batchId: {
            type: String,
            required: true,
            index: true
        },

        cropName: String,

        requestedQty: {
            type: Number,
            required: true
        },

        /* ===== Retailer ===== */

        retailerId: {
            type: String,
            required: true,
            index: true
        },

        retailerName: String,

        /* ===== Distributor ===== */

        distributorId: {
            type: String,
            required: true,
            index: true
        },

        distributorName: String,

        /* ===== Status Flow ===== */

        status: {
            type: String,
            enum: [
                "PENDING",
                "APPROVED",
                "REJECTED",
                "INVOICED",
                "DISPATCHED"
            ],
            default: "PENDING",
            index: true
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("StockRequest", StockRequestSchema);
