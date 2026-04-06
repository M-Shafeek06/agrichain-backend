// src/ml/trainModel.js

require("dotenv").config();

const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const generateDataset = require("./generateDataset");

/* ==================================
   DATABASE CONNECTION
================================== */

async function connectDB() {
  if (mongoose.connection.readyState === 1) return;

  console.log("⏳ Connecting to MongoDB Atlas...");

  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 15000
  });

  console.log("✅ MongoDB connected for ML training");
}

/* ==================================
   MATH HELPERS
================================== */

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function normalizeFeatures(X) {
  return X.map(row => [
    row[0],            // isValid flag
    row[1],            // chainValid flag
    row[2],            // distance flag
    row[3],            // quantity flag
    row[4] / 100,      // 🔥 normalize trust score
    row[5]             // status flag
  ]);
}

function trainLogisticRegression(X, Y, lr = 0.01, steps = 1500) {
  const n = X[0].length;

  let weights = Array(n).fill(0);
  let bias = 0;

  for (let step = 0; step < steps; step++) {

    let dw = Array(n).fill(0);
    let db = 0;

    for (let i = 0; i < X.length; i++) {

      const z =
        X[i].reduce((sum, x, j) => sum + x * weights[j], 0) + bias;

      const pred = sigmoid(z);
      const error = pred - Y[i];

      for (let j = 0; j < n; j++) {
        dw[j] += X[i][j] * error;
      }

      db += error;
    }

    for (let j = 0; j < n; j++) {
      weights[j] -= (lr * dw[j]) / X.length;
    }

    bias -= (lr * db) / X.length;
  }

  return { weights, bias };
}

/* ==================================
   SHUFFLE HELPER
================================== */

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

/* ==================================
   TRAIN MODEL
================================== */

async function trainModel() {
  try {

    await connectDB();

    /* ===============================
       DATASET GENERATION
    ================================ */

    const raw = await generateDataset();

    if (!Array.isArray(raw) || raw.length === 0) {
      console.log("⚠ No dataset available for ML training");
      return;
    }

    const safe = raw.filter(d => d.label === 0);
    const tampered = raw.filter(d => d.label === 1);

    console.log(`📊 Dataset: SAFE=${safe.length}, TAMPERED=${tampered.length}`);

    if (tampered.length === 0) {
      console.log("⚠ No tampered records found. Training skipped.");
      return;
    }

    /* ===============================
       OVERSAMPLING (BALANCE DATA)
    ================================ */

    const oversampledTampered = [];

    while (oversampledTampered.length < safe.length) {
      const r = tampered[Math.floor(Math.random() * tampered.length)];
      oversampledTampered.push(r);
    }

    const balanced = shuffle(safe.concat(oversampledTampered));

    console.log(
      `⚖ Balanced Dataset: SAFE=${safe.length}, TAMPERED=${oversampledTampered.length}`
    );

    /* ===============================
       TRAIN / TEST SPLIT
    ================================ */

    const splitIndex = Math.floor(balanced.length * 0.7);

    const trainSet = balanced.slice(0, splitIndex);
    const testSet = balanced.slice(splitIndex);

    console.log(`🧪 Training Samples: ${trainSet.length}`);
    console.log(`🔍 Testing Samples: ${testSet.length}`);

    const Xtrain = normalizeFeatures(trainSet.map(d => d.features));
    const Ytrain = trainSet.map(d => d.label);

    const Xtest = normalizeFeatures(testSet.map(d => d.features));
    const Ytest = testSet.map(d => d.label);

    /* ===============================
       TRAIN MODEL
    ================================ */

    const model = trainLogisticRegression(Xtrain, Ytrain);

    console.log("🧠 Model training completed");

    /* ===============================
       MODEL EVALUATION
    ================================ */

    let tp = 0, tn = 0, fp = 0, fn = 0;

    for (let i = 0; i < Xtest.length; i++) {

      const z =
        Xtest[i].reduce((sum, x, j) => sum + x * model.weights[j], 0)
        + model.bias;

      const pred = sigmoid(z) >= 0.5 ? 1 : 0;
      const actual = Ytest[i];

      if (pred === 1 && actual === 1) tp++;
      else if (pred === 1 && actual === 0) fp++;
      else if (pred === 0 && actual === 1) fn++;
      else tn++;
    }

    const accuracy = (tp + tn) / (tp + tn + fp + fn || 1);
    const precision = tp / (tp + fp || 1);
    const recall = tp / (tp + fn || 1);

    console.log("📊 Accuracy :", accuracy.toFixed(2));
    console.log("📊 Precision:", precision.toFixed(2));
    console.log("📊 Recall   :", recall.toFixed(2));

    /* ===============================
       SAVE MODEL
    ================================ */

    const modelPath = path.join(__dirname, "../../tamperModel.json");

    fs.writeFileSync(
      modelPath,
      JSON.stringify(model, null, 2)
    );

    /* ===============================
       SAVE EVALUATION
    ================================ */

    const evaluationPath = path.join(
      __dirname,
      "../../mlEvaluation.json"
    );

    fs.writeFileSync(
      evaluationPath,
      JSON.stringify({
        accuracy,
        precision,
        recall,
        confusionMatrix: { tp, tn, fp, fn },
        totalRecords: raw.length
      }, null, 2)
    );

    console.log("💾 Model saved → tamperModel.json");
    console.log("📄 Evaluation saved → mlEvaluation.json");
    console.log("🎯 ML Tamper Model Trained Successfully");

  }
  catch (err) {
    console.error("❌ ML training failed:", err.message);
  }
  finally {

    await mongoose.disconnect();
    console.log("🔌 MongoDB disconnected");

    process.exit(0);
  }
}

/* ==================================
   RUN IF DIRECTLY EXECUTED
================================== */

if (require.main === module) {
  trainModel();
}

module.exports = trainModel;