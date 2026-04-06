const mongoose = require("mongoose");

const RoleIdentitySchema = new mongoose.Schema({

  /* ---------- CORE AUTH FIELDS ---------- */

  roleId: {
    type: String,
    unique: true,
    required: true,
    trim: true
  },

  role: {
    type: String,
    enum: ["FARMER", "TRANSPORTER", "DISTRIBUTOR", "RETAILER", "ADMIN"],
    required: true
  },

  name: {
    type: String,
    required: true,
    trim: true
  },

  password: {
    type: String,
    required: true
  },

  resetToken: String,
  resetTokenExpiry: Date,


  /* ---------- COMMON PROFILE FIELDS ---------- */

  organization: {
    type: String,
    trim: true,
    default: ""
  },

  location: {
    type: String,
    trim: true,
    default: ""
  },

  emergencyContact: {
    type: String,
    trim: true,
    default: ""
  },


  /* ---------- ADMIN SPECIFIC FIELDS ---------- */

  department: {
    type: String,
    trim: true,
    default: ""
  },

  designation: {
    type: String,
    trim: true,
    default: ""
  },

  accessLevel: {
    type: String,
    trim: true,
    default: ""
  },

  officeContact: {
    type: String,
    trim: true,
    default: ""
  },

  adminNotes: {
    type: String,
    trim: true,
    default: ""
  },


  /* ---------- TRANSPORTER COMPLIANCE FIELDS ---------- */

  vehicleNumber: {
    type: String,
    trim: true,
    default: ""
  },

  vehicleType: {
    type: String,
    trim: true,
    default: ""
  },

  capacity: {
    type: Number,
    default: 0
  },

  warehouseCapacity: {
    type: Number,
    default: 0
  },

  licenseNo: {
    type: String,
    trim: true,
    default: ""
  },

  licenseExpiry: {
    type: String,
    trim: true,
    default: ""
  },

  rcBook: {
    type: String,
    trim: true,
    default: ""
  },

  insuranceTill: {
    type: String,
    trim: true,
    default: ""
  },

  preferredRoutes: {
    type: String,
    trim: true,
    default: ""
  },


  /* ---------- SYSTEM METADATA ---------- */

  createdAt: {
    type: Date,
    default: Date.now
  }

});

module.exports = mongoose.model("RoleIdentity", RoleIdentitySchema);
