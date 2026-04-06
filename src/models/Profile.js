const mongoose = require("mongoose");

const ProfileSchema = new mongoose.Schema({

    roleId: {
        type: String,
        required: true,
        unique: true
    },

    name: String,
    email: String,
    phone: String,

    organization: String,
    location: String,   // 🔒 Immutable identity field (already used)

    address: {
        type: String,
        default: ""
    },

    pincode: {
        type: String,
        default: ""
    },

    department: String,
    designation: String,
    accessLevel: String,

    role: {
        type: String,
        enum: ["ADMIN", "FARMER", "RETAILER", "TRANSPORTER", "DISTRIBUTOR"],
        required: true
    },

    createdAt: {
        type: Date,
        default: Date.now
    }

});

module.exports = mongoose.model("Profile", ProfileSchema);
