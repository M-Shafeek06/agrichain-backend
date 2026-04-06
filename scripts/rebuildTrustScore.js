require("dotenv").config();
const mongoose = require("mongoose");

const Shipment = require("../src/models/Shipment");
const TrustScore = require("../src/models/TrustScore");
const RoleIdentity = require("../src/models/RoleIdentity");

const MONGO_URI = process.env.MONGO_URI;

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("Mongo connected to Atlas");

    /* 1️⃣ CLEAR OLD TRUST DATA */
    await TrustScore.deleteMany({});
    console.log("Old trust records cleared");

    /* 2️⃣ FETCH ALL SHIPMENTS */
    const shipments = await Shipment.find().lean();

    for (const s of shipments) {
      const isValid = s.isValid !== false; // default true if missing

      /* ========= FARMER TRUST ========= */
      if (s.farmerId) {
        const farmer = await RoleIdentity.findOne({ roleId: s.farmerId }).lean();
        if (farmer) {
          await rebuildTrust({
            roleId: farmer.roleId,
            role: farmer.role,
            entityName: farmer.name,
            isValid
          });
        }
      }

      /* ========= RETAILER TRUST ========= */
      if (s.retailerId) {
        const retailer = await RoleIdentity.findOne({ roleId: s.retailerId }).lean();
        if (retailer) {
          await rebuildTrust({
            roleId: retailer.roleId,
            role: retailer.role,
            entityName: retailer.name,
            isValid
          });
        }
      }

      /* ========= TRANSPORTER TRUST ========= */
      if (s.handlerRole === "TRANSPORTER" && s.handlerId) {
        const transporter = await RoleIdentity.findOne({ roleId: s.handlerId }).lean();
        if (transporter) {
          await rebuildTrust({
            roleId: transporter.roleId,
            role: transporter.role,
            entityName: transporter.name,
            isValid
          });
        }
      }
    }

    console.log("✔ TrustScore rebuilt successfully");
    process.exit(0);

  } catch (err) {
    console.error("FAILED:", err);
    process.exit(1);
  }
})();

/* ================= TRUST REBUILD HELPER ================= */
async function rebuildTrust({ roleId, role, entityName, isValid }) {
  let record = await TrustScore.findOne({ roleId });

  if (!record) {
    record = new TrustScore({
      roleId,
      role,
      entityName,
      totalBlocks: 0,
      validBlocks: 0,
      trustScore: 0
    });
  }

  record.totalBlocks += 1;
  if (isValid) record.validBlocks += 1;

  record.trustScore = Math.round(
    (record.validBlocks / record.totalBlocks) * 100
  );

  await record.save();
}
