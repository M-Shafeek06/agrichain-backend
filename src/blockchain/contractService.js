require("dotenv").config();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const abi = require("./ProduceTrackerABI.json");

let provider = null;
let wallet = null;
let contract = null;

/**
 * Initialize blockchain connection once
 */
function initBlockchain() {
  if (contract) return;

  const RPC_URL = process.env.BLOCKCHAIN_RPC_URL;
  const PRIVATE_KEY = process.env.BLOCKCHAIN_PRIVATE_KEY;

  if (!RPC_URL || !PRIVATE_KEY) {
    throw new Error("BLOCKCHAIN_RPC_URL or BLOCKCHAIN_PRIVATE_KEY missing in .env");
  }

  provider = new ethers.JsonRpcProvider(RPC_URL);
  wallet = new ethers.Wallet(PRIVATE_KEY.trim(), provider);

  const addressPath = path.join(__dirname, "contractAddress.json");

  if (!fs.existsSync(addressPath)) {
    throw new Error("contractAddress.json not found. Deploy contract first.");
  }

  const { address } = JSON.parse(fs.readFileSync(addressPath, "utf8"));

  contract = new ethers.Contract(address, abi, wallet);

  console.log("🔐 Blockchain initialized:", address);
}

/**
 * Store hash on Ethereum
 */
async function storeHashOnChain(batchId, hash) {
  initBlockchain();

  const tx = await contract.storeBatchHash(batchId, hash);
  await tx.wait();
}

/**
 * Read hash from Ethereum
 */
async function getHashFromChain(batchId) {
  initBlockchain();
  return await contract.getBatchHash(batchId);
}

module.exports = {
  storeHashOnChain,
  getHashFromChain
};
