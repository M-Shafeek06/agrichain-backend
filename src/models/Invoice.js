const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
    {
        invoiceId: { type: String, required: true, unique: true },

        batchId: { type: String, required: true },
        distributorId: { type: String, required: true },
        retailerId: { type: String, default: null },

        cropName: { type: String },

        transporterName: { type: String, required: true },
        transporterId: { type: String, required: true },
        vehicleNumber: { type: String, required: true },
        transportDate: { type: String, required: true },
        charge: { type: Number, required: true },
        hash: { type: String },
        originalPayload: {
            type: Object,
            required: false
        },
        fromLocation: {
            type: String,
            required: true
        },

        toLocation: {
            type: String,
            required: true
        },
        status: {
            type: String,
            default: "GENERATED"
        }
    },
    { timestamps: true }
);

module.exports = mongoose.model("Invoice", invoiceSchema);
