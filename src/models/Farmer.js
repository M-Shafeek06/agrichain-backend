const mongoose = require("mongoose");

const FarmerSchema = new mongoose.Schema({
  roleId: {
    type: String,
    required: true,
    unique: true
  },

  name: {
    type: String,
    required: true
  },

  location: {
    type: String
  },

  walletAddress: {
    type: String
  },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Farmer", FarmerSchema);
