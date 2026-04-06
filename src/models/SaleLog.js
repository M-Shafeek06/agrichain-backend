const mongoose = require("mongoose");

const saleLogSchema = new mongoose.Schema(
    {
        inventoryId: String,
        retailerId: String,
        batchId: String,
        cropName: String,

        quantitySold: Number,
        remainingAfterSale: Number,

        basePerKgPrice: Number,
        retailerMarginPercent: Number,
        finalPerKgPrice: Number,
        totalSaleValue: Number,
        profitEarned: Number,

        previousHash: {
            type: String,
            default: "GENESIS"
        },

        saleHash: {
            type: String,
            required: true
        }

    },
    { timestamps: true }
);

module.exports = mongoose.model("SaleLog", saleLogSchema);