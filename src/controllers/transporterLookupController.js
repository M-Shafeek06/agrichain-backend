const Role = require("../models/RoleIdentity");

exports.getTransporters = async (req, res) => {
    try {
        const transporters = await Role.find(
            { role: "TRANSPORTER" },
            {
                roleId: 1,
                name: 1,
                vehicleNumber: 1,
                _id: 0
            }
        );

        res.json(transporters);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Failed to fetch transporters" });
    }
};
