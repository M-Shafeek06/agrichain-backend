const { ethers, NonceManager } = require("ethers");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const artifact = require("../config/ProduceTracker.json");
const abi = artifact.abi;

const GasLog = require("../models/GasLog");

let provider;
let wallet;
let contract;

/**
 * Initialize Blockchain Connection (Singleton)
 */
function initBlockchain() {
  if (contract) return;

  if (!process.env.BLOCKCHAIN_RPC_URL || !process.env.BLOCKCHAIN_PRIVATE_KEY) {
    throw new Error("Blockchain environment variables not configured");
  }

  provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);

  const rawWallet = new ethers.Wallet(
    process.env.BLOCKCHAIN_PRIVATE_KEY,
    provider
  );

  wallet = new NonceManager(rawWallet);

  const addressPath = path.join(
    __dirname,
    "../config/contractAddress.json"
  );

  const { address } = JSON.parse(
    fs.readFileSync(addressPath, "utf8")
  );

  contract = new ethers.Contract(address, abi, wallet);

  console.log("🔐 Blockchain initialized:", address);
}

/* =========================================================
   GENESIS BATCH ANCHOR
========================================================= */

exports.storeHashOnBlockchain = async (batchId, hash) => {
  try {
    initBlockchain();
    await wallet.getNonce("latest");

    const formattedHash = hash.startsWith("0x") ? hash : "0x" + hash;

    const tx = await contract.storeBatchHash(batchId, formattedHash);
    const receipt = await tx.wait();

    console.log("TX HASH:", receipt.hash);

    await GasLog.create({
      batchId,
      txHash: receipt.hash,
      gasUsed: Number(receipt.gasUsed.toString()),
      operation: "STORE_HASH"
    });

    console.log("🔗 Genesis Anchored:", batchId);
    return formattedHash.replace(/^0x/, "");

  } catch (err) {
    console.error("❌ Genesis Anchor Error:", err);
    throw err;
  }
};

exports.getHashFromBlockchain = async (batchId) => {
  try {
    initBlockchain();

    const chainHash = await contract.getBatchHash(batchId);

    if (!chainHash) return null;

    return chainHash.replace(/^0x/, "");

  } catch (err) {
    // ✅ Gracefully handle missing batch after blockchain reset
    if (
      err.code === "CALL_EXCEPTION" &&
      err.reason &&
      err.reason.includes("Batch does not exist")
    ) {
      console.warn(
        "⚠ Blockchain record not found (likely node restart):",
        batchId
      );
      return null;
    }

    // Only log real unexpected errors
    console.error("❌ Blockchain Fetch Error:", err.message);
    return null;
  }
};

/* =========================================================
   ADMIN VERIFICATION ANCHOR
========================================================= */

exports.storeAdminVerificationOnBlockchain = async (
  batchId,
  verifiedBy,
  remark
) => {
  try {
    initBlockchain();
    await wallet.getNonce("latest");

    const rawData = `${batchId}-${verifiedBy}-${remark}-${Date.now()}`;
    const hash = crypto.createHash("sha256").update(rawData).digest("hex");

    const tx = await contract.storeAdminVerificationHash(
      batchId,
      "0x" + hash
    );

    const receipt = await tx.wait();

    await GasLog.create({
      batchId,
      txHash: receipt.hash,
      gasUsed: Number(receipt.gasUsed.toString()),
      operation: "ADMIN_VERIFICATION"
    });

    console.log("🛡 Admin Verification Anchored:", batchId);
    return hash;

  } catch (err) {
    console.error("❌ Admin Verification Anchor Error:", err);
    throw err;
  }
};


/* =========================================================
   ADMIN VERIFICATION FETCH
========================================================= */

exports.getAdminVerificationCountFromBlockchain = async (batchId) => {
  try {
    initBlockchain();
    return await contract.getAdminVerificationCount(batchId);
  } catch (err) {
    console.error("❌ Fetch Admin Verification Count Error:", err);
    throw err;
  }
};

exports.getAdminVerificationHashFromBlockchain = async (batchId, index) => {
  try {
    initBlockchain();
    const hash = await contract.getAdminVerificationHash(batchId, index);
    return hash.replace(/^0x/, "");
  } catch (err) {
    console.error("❌ Fetch Admin Verification Hash Error:", err);
    throw err;
  }
};

/* =========================================================
   OWNERSHIP TRANSFER ANCHOR
========================================================= */

exports.storeOwnershipTransferOnBlockchain = async (
  batchId,
  fromId,
  toId
) => {
  try {
    initBlockchain();
    await wallet.getNonce("latest");

    const rawData = `${batchId}-${fromId}-${toId}-${Date.now()}`;
    const hash = crypto.createHash("sha256").update(rawData).digest("hex");

    const tx = await contract.storeOwnershipTransferHash(
      batchId,
      "0x" + hash
    );

    const receipt = await tx.wait();

    await GasLog.create({
      batchId,
      txHash: receipt.hash,
      gasUsed: Number(receipt.gasUsed.toString()),
      operation: "OWNERSHIP_TRANSFER"
    });

    console.log("🔄 Ownership Transfer Anchored:", batchId);
    return hash;

  } catch (err) {
    console.error("❌ Ownership Transfer Anchor Error:", err);
    throw err;
  }
};

/* =========================================================
   RETAIL ALLOCATION ANCHOR
========================================================= */

exports.storeRetailAllocationOnBlockchain = async (
  batchId,
  retailerId,
  quantity
) => {
  try {
    initBlockchain();
    await wallet.getNonce("latest");

    const timestamp = Date.now();

    const rawData = `${batchId}-${retailerId}-${quantity}-${timestamp}`;

    const allocationHash = crypto
      .createHash("sha256")
      .update(rawData)
      .digest("hex");

    const tx = await contract.storeRetailAllocationHash(
      batchId,
      "0x" + allocationHash
    );

    const receipt = await tx.wait();

    await GasLog.create({
      batchId,
      txHash: receipt.hash,
      gasUsed: Number(receipt.gasUsed.toString()),
      operation: "RETAIL_ALLOCATION"
    });

    console.log("🏬 Retail Allocation Anchored:", batchId);

    return {
      allocationHash,
      timestamp
    };

  } catch (err) {
    console.error("❌ Retail Allocation Anchor Error:", err);
    throw err;
  }
};