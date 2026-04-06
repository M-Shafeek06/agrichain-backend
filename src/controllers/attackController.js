const Produce = require("../models/Produce");

exports.simulateTamperAttack = async (req, res) => {
  try {
    const { batchId } = req.params;

    const produce = await Produce.findOne({ batchId });
    if (!produce) {
      return res.status(404).json({ message: "Batch not found" });
    }

    // 🔒 Forensic lock – block re-tampering
    if (produce.integrityStatus?.includes("TAMPERED")) {
      return res.status(400).json({
        message: "Batch already tampered. Further modification blocked."
      });
    }

    // 🔥 Simulate illegal DB modification
    produce.quantity = Number(produce.quantity || 0) + 50;

    if (!produce.cropName.includes("(HACKED)")) {
      produce.cropName = `${produce.cropName} (HACKED)`;
    }

    produce.integrityStatus = "TAMPERED";
    produce.integrityScore = 0;
    produce.status = "REJECTED";

    await produce.save();

    // ❌ DO NOT WRITE IntegrityLog HERE
    // ✔ Forensic engine will detect & log on verification

    return res.json({
      success: true,
      message: "Tamper attack simulated successfully"
    });

  } catch (err) {
    console.error("Tamper Simulation Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
