require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("crypto");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const Produce = require("../src/models/Produce");
const IntegrityLog = require("../src/models/IntegrityLog");
const canonicalStringify = require("../src/utils/canonicalStringify");

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/agri-chain-trust";

async function rebuildBlockchain() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected");

    const provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
    const wallet = new ethers.Wallet(process.env.BLOCKCHAIN_PRIVATE_KEY, provider);

    const abi = require("../src/blockchain/ProduceTrackerABI.json");
    const addressPath = path.join(__dirname, "../src/blockchain/contractAddress.json");
    const { address } = JSON.parse(fs.readFileSync(addressPath));

    const contract = new ethers.Contract(address, abi, wallet);
    console.log("🔐 Blockchain initialized:", address);

    const produces = await Produce.find();
    if (!produces.length) {
      console.log("⚠ No produce records found.");
      process.exit(0);
    }

    let nonce = await provider.getTransactionCount(wallet.address, "latest");

    for (const p of produces) {
      console.log(`♻ Rebuilding snapshot: ${p.batchId}`);

      // 🔐 FORENSIC IMMUTABLE GENESIS SNAPSHOT
      const immutableSnapshot = {
        batchId: String(p.batchId),
        farmerId: String(p.farmerId),
        farmerName: String(p.farmerName),
        cropName: String(p.cropName),
        quantity: Number(p.quantity),
        qualityGrade: String(p.qualityGrade),
        harvestDate: new Date(p.harvestDate).toISOString(),
        ipfsHash: String(p.ipfsHash || ""),
        shipments: []
      };

      const genesisHash = crypto
        .createHash("sha256")
        .update(canonicalStringify(immutableSnapshot))
        .digest("hex");

      console.log(`🔗 Anchoring: ${p.batchId} (nonce=${nonce})`);

      const tx = await contract.storeBatchHash(p.batchId, "0x" + genesisHash, { nonce });
      await tx.wait();
      nonce++;

      await new Promise(r => setTimeout(r, 400));

      // 💾 STORE VERIFIED STATE
      p.originalSnapshot = immutableSnapshot;
      p.genesisHash = genesisHash;
      p.integrityStatus = "AUTHENTIC";
      p.integrityScore = 100;
      await p.save({ validateBeforeSave: false });

      // 🔥 Clear all old forensic noise
      await IntegrityLog.updateMany(
        { batchId: p.batchId },
        { $set: { resolved: true } }
      );

      console.log(`🧬 Genesis anchored: ${p.batchId}`);
    }

    console.log("🎯 Blockchain rebuild completed successfully.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Rebuild Blockchain Failed:", err.message);
    process.exit(1);
  }
}

rebuildBlockchain();
