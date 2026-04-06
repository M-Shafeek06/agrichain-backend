const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");


router.get("/evaluation", async (req, res) => {
  try {

    const filePath = path.join(__dirname, "../../mlEvaluation.json");

    if (!fs.existsSync(filePath)) {
      return res.json({
        accuracy: "N/A",
        precision: "N/A",
        recall: "N/A",
        confusionMatrix: { tp: 0, tn: 0, fp: 0, fn: 0 },
        totalRecords: 0
      });
    }

    const rawData = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(rawData);

    const accuracy = Number(data.accuracy || 0);
    const precision = Number(data.precision || 0);
    const recall = Number(data.recall || 0);

    const confusionMatrix = data.confusionMatrix || {
      tp: 0, tn: 0, fp: 0, fn: 0
    };

    const totalRecords = data.totalRecords || 0;

    return res.json({
      accuracy: accuracy.toFixed(2),
      precision: precision.toFixed(2),
      recall: recall.toFixed(2),
      confusionMatrix,
      totalRecords
    });

  } catch (err) {
    console.error("❌ ML Evaluation Route Crash:", err.message);

    return res.status(500).json({
      message: "ML Evaluation failed",
      error: err.message
    });
  }
});


module.exports = router;