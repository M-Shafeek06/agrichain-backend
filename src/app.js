const express = require("express");
const cors = require("cors");

const app = express();

/* ================= MIDDLEWARE ================= */
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

/* ================= ROUTE IMPORTS ================= */
const roleRoutes = require("./routes/roleRoutes");
const farmerRoutes = require("./routes/farmerRoutes");
const produceRoutes = require("./routes/produceRoutes");
const shipmentRoutes = require("./routes/shipmentRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const verifyRoutes = require("./routes/verifyRoutes");
const profileRoutes = require("./routes/profileRoutes");
const repairRoutes = require("./routes/repairRoutes");
const trustRoutes = require("./routes/trustRoutes");
const retailerRoutes = require("./routes/retailerRoutes");
const adminRoutes = require("./routes/adminRoutes");
const certificateRoutes = require("./routes/certificateRoutes");
const mlRoutes = require("./routes/mlRoutes");
const gasRoutes = require("./routes/gasRoutes");
const attackRoutes = require("./routes/attackRoutes");
const transporterRoutes = require("./routes/transporterRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const distributorRoutes = require("./routes/distributorRoutes");
const retailerRequestRoutes = require("./routes/retailerRequestRoutes");
const stockRequestRoutes = require("./routes/stockRequestRoutes");
const distributorRequestRoutes = require("./routes/distributorRequestRoutes");
const marketplaceRoutes = require("./routes/marketplaceRoutes");
const integrityRoutes = require("./routes/integrityRoutes");

/* ================= API ROUTES ================= */
app.use("/api/roles", roleRoutes);
app.use("/api/farmer", farmerRoutes);
app.use("/api/produce", produceRoutes);
app.use("/api/shipments", shipmentRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/repair", repairRoutes);
app.use("/api/verify", verifyRoutes);   // ✅ FIXED

app.use("/api/trust", trustRoutes);
app.use("/api/retailer", retailerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/certificate", certificateRoutes);
app.use("/api/ml", mlRoutes);
app.use("/api/gas", gasRoutes);
app.use("/api/attack", attackRoutes);

app.use("/api/transporter", transporterRoutes);
app.use("/api", invoiceRoutes);
app.use("/api/distributor", distributorRoutes);
app.use("/api/distributor", require("./routes/distributorPublicRoutes"));

app.use("/api", retailerRequestRoutes);
app.use("/api", stockRequestRoutes);
app.use("/api/marketplace", marketplaceRoutes);
app.use("/api/distributor", distributorRequestRoutes);
app.use("/api", require("./routes/transporterLookupRoutes"));

app.use("/api/inventory", require("./routes/inventoryRoutes"));
app.use("/api", integrityRoutes);

/* ================= HEALTH CHECK ================= */
app.get("/", (req, res) => {
  res.send("AgriChainTrust API Running");
});

/* ================= GLOBAL ERROR HANDLER ================= */
app.use((err, req, res, next) => {
  console.error("🔥 GLOBAL ERROR:", err);

  if (err.type === "entity.parse.failed") {
    return res.status(400).json({
      message: "Invalid JSON format sent to server"
    });
  }

  res.status(500).json({
    message: "Internal Server Error",
    error: err.message
  });
});

module.exports = app;