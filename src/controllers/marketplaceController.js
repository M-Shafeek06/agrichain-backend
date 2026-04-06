const Produce = require("../models/Produce");
const RoleIdentity = require("../models/RoleIdentity");
const { verifyBatch } = require("./verifyController"); // 🔥 ADD THIS

exports.getMarketplace = async (req, res) => {
    try {

        const produceList = await Produce.find({
            remainingQuantity: { $gt: 0 },
            verificationStatus: "APPROVED",
            $or: [
                { currentOwnerRole: "DISTRIBUTOR" },
                { state: "IN_TRANSPORT_TO_RETAILER" }
            ]
        }).lean();

        if (!produceList.length) {
            return res.json([]);
        }

        /* =====================================================
           🔥 VERIFY EACH BATCH (REAL-TIME TAMPER FILTER)
        ===================================================== */

        const safeProduceList = [];

        for (const batch of produceList) {

            const verification = await verifyBatch(batch.batchId);

            if (verification.status === "AUTHENTIC") {
                safeProduceList.push(batch);
            }
        }

        if (!safeProduceList.length) {
            return res.json([]);
        }

        /* =====================================================
           🔗 DISTRIBUTOR MAPPING
        ===================================================== */

        const distributorIds = [
            ...new Set(safeProduceList.map(p => p.distributorId))
        ];

        const distributors = await RoleIdentity.find({
            roleId: { $in: distributorIds }
        }).lean();

        const distributorMap = new Map(
            distributors.map(d => [d.roleId, d.name])
        );

        /* =====================================================
           📦 FINAL LISTINGS
        ===================================================== */

        const listings = safeProduceList.map(item => {

            const distributorId = item.distributorId;

            return {
                batchId: item.batchId,
                crop: item.cropName,
                qty: item.remainingQuantity,
                distributorId,
                distributorName: distributorMap.get(distributorId) || "Unknown",
                harvestDate: item.harvestDate
            };
        });

        res.json(listings);

    } catch (err) {
        console.error("Marketplace error:", err);

        res.status(500).json({
            error: "Failed to load marketplace"
        });
    }
};