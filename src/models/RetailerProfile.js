const mongoose = require("mongoose");

const retailerProfileSchema = new mongoose.Schema({
    roleId: { type: String, required: true, unique: true },
    storeName: String,
    gstNumber: String,
    fssaiLicense: String,
    storageCapacity: String,
    emergencyContact: String
}, { timestamps: true });

module.exports = mongoose.model("RetailerProfile", retailerProfileSchema);
