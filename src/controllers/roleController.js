const RoleIdentity = require("../models/RoleIdentity");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/* ================= REGISTER ROLE ================= */

exports.registerRole = async (req, res) => {
  try {
    const { role, name, password, organization, location } = req.body;

    if (!role || !name || !password)
      return res.status(400).json({ message: "Role, name, and password are required" });

    /* ===== NAME VALIDATION ===== */

    const cleanName = name.trim();

    if (!/^[A-Za-z\s]{1,25}$/.test(cleanName)) {
      return res.status(400).json({
        message: "Name must contain only letters and be under 25 characters"
      });
    }

    const upperRole = role.toUpperCase();

    /* ===== ADMIN LIMIT CHECK START ===== */
    if (upperRole === "ADMIN") {
      const existingAdmin = await RoleIdentity.findOne({ role: "ADMIN" });

      if (existingAdmin) {
        return res.status(400).json({
          message: "Admin registration not possible. Maximum registration limit reached."
        });
      }
    }
    /* ===== ADMIN LIMIT CHECK END ===== */

    const roleId = `${upperRole}-${uuidv4().slice(0, 8)}`;
    const hashedPassword = await bcrypt.hash(password.trim(), 10);

    const identity = await RoleIdentity.create({
      roleId,
      role: upperRole,
      name: name.trim(),
      password: hashedPassword,
      organization: organization || "N/A",
      location: location || "N/A"
    });

    res.status(201).json({
      message: "Role registered successfully",
      roleId: identity.roleId,
      role: identity.role,
      name: identity.name
    });

  } catch (err) {
    console.error("❌ REGISTER ROLE ERROR:", err);
    res.status(500).json({ message: "Role registration failed" });
  }
};

/* ================= LOGIN ROLE ================= */

exports.loginRole = async (req, res) => {
  try {

    console.log("🟢 LOGIN REQUEST BODY:", req.body);

    const roleId = (req.body.roleId || "").trim();
    const password = (req.body.password || "").trim();

    if (!roleId || !password)
      return res.status(400).json({ message: "Role ID and password required" });

    const identity = await RoleIdentity.findOne({ roleId });

    if (!identity) {
      console.log("❌ ROLE NOT FOUND:", roleId);
      return res.status(401).json({ message: "Invalid Role ID" });
    }

    const isMatch = await bcrypt.compare(password, identity.password);

    if (!isMatch) {
      console.log("❌ PASSWORD FAILED FOR:", roleId);
      return res.status(401).json({ message: "Invalid Password" });
    }

    console.log("✅ LOGIN SUCCESS:", identity.roleId);

    /* ================= GENERATE JWT TOKEN ================= */

    const token = jwt.sign(
      {
        roleId: identity.roleId,
        role: identity.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    /* ================= SEND RESPONSE ================= */

    res.status(200).json({
      roleId: identity.roleId,
      role: identity.role,
      name: identity.name,
      token
    });

  } catch (err) {
    console.error("🔥 LOGIN ROLE ERROR:", err);
    res.status(500).json({ message: "Login failed" });
  }
};

/* ================= FORGOT PASSWORD ================= */

exports.forgotPassword = async (req, res) => {
  try {
    const roleId = (req.body.roleId || "").trim();
    const phone = (req.body.phone || "").trim();

    const identity = await RoleIdentity.findOne({
      roleId,
      emergencyContact: phone
    });

    if (!identity) {
      return res.status(404).json({ message: "Role ID or phone number incorrect" });
    }
    if (!identity)
      return res.status(404).json({ message: "Role identity not found" });

    const resetToken = crypto.randomBytes(32).toString("hex");

    identity.resetToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    identity.resetTokenExpiry = Date.now() + 10 * 60 * 1000;

    await identity.save();

    res.json({ message: "Password reset token generated", resetToken });

  } catch (err) {
    console.error("❌ FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ message: "Forgot password failed" });
  }
};

/* ================= RESET PASSWORD ================= */

exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const identity = await RoleIdentity.findOne({
      resetToken: hashedToken,
      resetTokenExpiry: { $gt: Date.now() }
    });

    if (!identity)
      return res.status(400).json({ message: "Invalid or expired token" });

    identity.password = await bcrypt.hash(newPassword.trim(), 10);
    identity.resetToken = undefined;
    identity.resetTokenExpiry = undefined;

    await identity.save();

    res.json({ message: "Password reset successful" });

  } catch (err) {
    console.error("❌ RESET PASSWORD ERROR:", err);
    res.status(500).json({ message: "Password reset failed" });
  }
};
