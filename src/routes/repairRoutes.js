const express = require("express");
const router = express.Router();
const Shipment = require("../models/Shipment");
const getCoordinates = require("../utils/geoCache");

router.get("/repair-latest-gps", async (req, res) => {
    try {
        const docs = await Shipment.find({ "latest.lat": { $exists: false } });

        let fixed = 0;

        for (const doc of docs) {
            const coord = await getCoordinates(doc.location);
            if (!coord || !coord.lat) continue;

            await Shipment.updateOne(
                { _id: doc._id },
                {
                    $set: {
                        "latest.location": doc.location,
                        "latest.lat": coord.lat,
                        "latest.lng": coord.lng,
                        "latest.status": doc.status,
                        "latest.updatedAt": new Date()
                    }
                }
            );

            fixed++;
        }

        res.json({ fixed });
    } catch (err) {
        console.error("REPAIR ERROR:", err);
        res.status(500).json({ error: "Repair failed" });
    }
});

module.exports = router;
