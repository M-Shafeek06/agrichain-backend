const Farmer = require("../models/Farmer");
const Produce = require("../models/Produce");
const TrustScore = require("../models/TrustScore");

exports.registerFarmer = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        error: "Farmer data is required"
      });
    }

    const farmer = new Farmer(req.body);
    await farmer.save();

    /* =========================================================
       🔐 CREATE TRUST RECORD (SAFE)
       ========================================================= */
    await TrustScore.create({
      roleId: farmer.roleId || farmer._id.toString(),
      role: "FARMER",
      entityName: farmer.name,
      trustScore: 50,
      totalBlocks: 0,
      validBlocks: 0
    });

    return res.status(201).json(farmer);

  } catch (error) {
    console.error("❌ FARMER REGISTRATION ERROR:", error);

    return res.status(500).json({
      error: error.message || "Failed to register farmer"
    });
  }
};


exports.getFarmerProduceHistory = async (req, res) => {
  try {
    const farmerId = req.params.id;

    if (!farmerId) {
      return res.status(400).json({
        message: "Farmer ID required"
      });
    }

    const produceList = await Produce.find({ farmerId })
      .sort({ createdAt: -1 })
      .lean();

    // Enrich produce records with invoice metadata
    const enriched = produceList.map(p => {
      const invoice = p.transporterInvoice || null;

      return {
        ...p,

        // ✅ Keep original behavior
        invoice,

        // ✅ NEW: Explicit frontend helpers (non-breaking)
        invoiceAvailable: Boolean(invoice),
        invoiceStatus: invoice?.status || null
      };
    });

    return res.json(enriched);

  } catch (error) {
    console.error("❌ FARMER HISTORY ERROR:", error);

    return res.status(500).json({
      message: "Failed to fetch farmer produce history"
    });
  }
};
