const Role = require("../models/RoleIdentity");

exports.getDistributorList = async (req, res) => {
    try {
        const distributors = await Role.find(
            { role: "DISTRIBUTOR" },
            { roleId: 1, name: 1, location: 1, _id: 0 }
        );

        res.json(distributors);
    } catch (err) {
        console.error("Distributor list error:", err);
        res.status(500).json({ message: "Failed to fetch distributors" });
    }

};
