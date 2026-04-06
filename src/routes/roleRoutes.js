const express = require("express");
const router = express.Router();

const {
  registerRole,
  loginRole,
  forgotPassword,
  resetPassword
} = require("../controllers/roleController");

/**
 * ROLE AUTH ROUTES
 * Mounted in server.js as:
 * app.use("/api/roles", roleRoutes);
 */

router.post("/register", registerRole);
router.post("/login", loginRole);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
