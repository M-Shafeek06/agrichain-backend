const fs = require("fs");
const path = require("path");

let model = null;

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function loadModel() {
  if (model) return;

  const modelPath = path.join(__dirname, "../../tamperModel.json");

  if (!fs.existsSync(modelPath)) {
    throw new Error("tamperModel.json not found. Train ML model first.");
  }

  const data = JSON.parse(fs.readFileSync(modelPath, "utf8"));

  if (!Array.isArray(data.weights) || typeof data.bias !== "number") {
    throw new Error("Invalid ML model format. Retrain the model.");
  }

  model = data;
}

module.exports = function predictTamperML(rawFeatures) {
  loadModel();

  if (!Array.isArray(rawFeatures) || rawFeatures.length === 0) {
    return { probability: 0, risk: "LOW" };
  }

  const features = [
    rawFeatures[0],
    rawFeatures[1],
    rawFeatures[2],
    rawFeatures[3],
    rawFeatures[4] / 100,  // 🔥 MUST match training
    rawFeatures[5]
  ];

  const z =
    features.reduce((sum, x, i) => sum + x * (model.weights[i] || 0), 0) +
    model.bias;

  const prob = sigmoid(z);

  const percentage = prob * 100;

  return {
    probability: Number(percentage.toFixed(2)), // ✅ FIXED
    risk:
      prob > 0.85 ? "CRITICAL" :
        prob > 0.70 ? "HIGH" :
          prob > 0.45 ? "MEDIUM" : "LOW"
  };
};
