const RoleIdentity = require("../models/RoleIdentity");
const RetailerProfile = require("../models/RetailerProfile");
const Profile = require("../models/Profile");
const Produce = require("../models/Produce");

/* ======================================================
   GET PROFILE
====================================================== */
exports.getProfile = async (req, res) => {
    try {
        const { roleId } = req.params;

        /* ---------- BASE USER ---------- */
        const user = await RoleIdentity.findOne({ roleId })
            .select("-password -resetToken -resetTokenExpiry");

        if (!user) {
            return res.status(404).json({ message: "Profile not found" });
        }

        /* ---------- TRUST SCORE (LIVE, FARMER ONLY) ---------- */
        let trustScore = 0;

        if (user.role === "FARMER") {
            const [totalBatches, authenticBatches] = await Promise.all([
                Produce.countDocuments({ farmerId: roleId }),
                Produce.countDocuments({
                    farmerId: roleId,
                    integrityStatus: "AUTHENTIC"
                })
            ]);

            trustScore =
                totalBatches > 0
                    ? Math.round((authenticBatches / totalBatches) * 100)
                    : 0;
        }

        /* ---------- BASE PROFILE (COMMON RESPONSE) ---------- */
        const baseProfile = {
            ...user.toObject(),
            emergencyContact: user.emergencyContact || "",
            trustScore,
            blockchainVerified: true,
            verifiedAt: user.createdAt,
            blockchainNetwork: "AgriChainTrust Ledger (Ethereum-based)"
        };

        /* ---------- RETAILER PROFILE MERGE ---------- */
        if (user.role === "RETAILER") {
            let retailer = await RetailerProfile.findOne({ roleId });

            if (!retailer) {
                retailer = await RetailerProfile.create({ roleId });
            }

            let profile = await Profile.findOneAndUpdate(
                { roleId },
                {
                    $setOnInsert: {
                        roleId,
                        role: user.role,
                        location: user.location
                    }
                },
                { new: true, upsert: true }
            );

            return res.json({
                ...baseProfile,
                ...retailer.toObject(),
                address: profile.address || "",
                pincode: profile.pincode || ""
            });
        }

        /* ---------- ADMIN CUSTOM RESPONSE ---------- */
        if (user.role === "ADMIN") {
            return res.json({
                ...baseProfile,
                department: user.department || "",
                designation: user.designation || "",
                officeContact: user.officeContact || ""
            });
        }

        /* ---------- FARMER / TRANSPORTER PROFILE DATA ---------- */
        let profile = await Profile.findOneAndUpdate(
            { roleId },
            {
                $setOnInsert: {
                    roleId,
                    name: user.name,
                    organization: user.organization,
                    location: user.location,
                    role: user.role
                }
            },
            { new: true, upsert: true }
        );

        return res.json({
            ...baseProfile,
            address: profile.address || "",
            pincode: profile.pincode || ""
        });

    } catch (err) {
        console.error("PROFILE FETCH ERROR:", err);
        return res.status(500).json({ message: "Server error" });
    }
};


function validateProfileInput(data) {

    /* ---- TRIM INPUTS ---- */
    if (data.name) data.name = data.name.trim();
    if (data.organization) data.organization = data.organization.trim();
    if (data.address) data.address = data.address.trim();
    if (data.department) data.department = data.department.trim();
    if (data.designation) data.designation = data.designation.trim();

    /* FULL NAME */
    if (data.name && !/^[A-Za-z ]{1,25}$/.test(data.name)) {
        return "Full name must contain only letters and spaces (max 25)";
    }

    /* ORGANIZATION */
    if (data.organization && !/^[A-Za-z ]{1,25}$/.test(data.organization)) {
        return "Organization must contain only letters and spaces (max 25)";
    }

    /* ADDRESS */
    if (data.address && data.address.length > 35) {
        return "Address must not exceed 35 characters";
    }

    /* PINCODE */
    if (data.pincode && !/^[0-9]{6}$/.test(data.pincode)) {
        return "Pincode must be exactly 6 digits";
    }

    /* EMERGENCY CONTACT */
    if (data.emergencyContact && !/^[0-9]{10}$/.test(data.emergencyContact)) {
        return "Contact number must be exactly 10 digits";
    }

    /* OFFICE CONTACT (Admin landline format) */
    if (data.officeContact && !/^[0-9-]{8,12}$/.test(data.officeContact)) {
        return "Invalid office contact format";
    }

    /* DEPARTMENT (Admin) */
    if (data.department && data.department.length > 25) {
        return "Department must not exceed 25 characters";
    }

    /* DESIGNATION (Admin) */
    if (data.designation && data.designation.length > 25) {
        return "Designation must not exceed 25 characters";
    }

    /* VEHICLE TYPE (e.g. 4 - Wheeler) */
    if (data.vehicleType && !/^[0-9]\s-\sWheeler$/.test(data.vehicleType)) {
        return "Vehicle type must follow format like '4 - Wheeler'";
    }

    /* LICENSE NUMBER (exactly 16 alphanumeric) */
    if (data.licenseNo && !/^[A-Z0-9]{16}$/.test(data.licenseNo)) {
        return "License number must be exactly 16 characters";
    }

    /* VEHICLE NUMBER */
    if (data.vehicleNumber && !/^[A-Za-z0-9-]{5,13}$/.test(data.vehicleNumber)) {
        return "Invalid vehicle number format";
    }

    /* CAPACITY */
    if (data.capacity && (Number(data.capacity) < 1 || Number(data.capacity) > 5)) {
        return "Capacity must be between 1 and 5 tons";
    }

    /* RC BOOK (10 alphanumeric + 2 hyphens) */
    if (data.rcBook && !/^[A-Z0-9]{2,5}-[A-Z0-9]{2,5}-[A-Z0-9]{3,5}$/.test(data.rcBook)) {
        return "RC Book must contain alphanumeric with two '-' separators";
    }

    /* STORE NAME */
    if (data.storeName && data.storeName.length > 30) {
        return "Store name must not exceed 30 characters";
    }

    /* GST NUMBER (India GST format) */
    if (data.gstNumber && !/^[0-9A-Z]{15}$/.test(data.gstNumber)) {
        return "Invalid GST number format";
    }

    /* FSSAI LICENSE (14 digits) */
    if (data.fssaiLicense && !/^[0-9]{14}$/.test(data.fssaiLicense)) {
        return "FSSAI license must be 14 digits";
    }

    /* STORAGE CAPACITY (1 – 10000 kg only) */
    if (data.storageCapacity) {

        const capacity = parseInt(data.storageCapacity);

        if (isNaN(capacity) || capacity < 1 || capacity > 10000) {
            return "Storage capacity must be between 1 and 10000 KG";
        }

    }

    /* WAREHOUSE CAPACITY */
    if (data.warehouseCapacity && (Number(data.warehouseCapacity) < 1 || Number(data.warehouseCapacity) > 50000)) {
        return "Warehouse capacity must be between 1 and 50000 KG";
    }

    /* ORGANIZATION */
    if (data.organization && data.organization.length > 30) {
        return "Organization name must not exceed 30 characters";
    }

    return null;
}

/* ======================================================
   UPDATE PROFILE
====================================================== */
exports.updateProfile = async (req, res) => {
    try {
        const { roleId } = req.params;

        const user = await RoleIdentity.findOne({ roleId });

        if (!user) {
            return res.status(404).json({ message: "Profile not found" });
        }

        /* ---------- INPUT VALIDATION ---------- */

        const validationError = validateProfileInput(req.body);

        if (validationError) {
            return res.status(400).json({ message: validationError });
        }

        /* ---------- RETAILER UPDATE ---------- */
        if (user.role === "RETAILER") {
            /* ===== Retailer compliance fields (RetailerProfile) ===== */
            /* ===== Retailer compliance fields (RetailerProfile) ===== */

            const allowedRetailerFields = [
                "storeName",
                "gstNumber",
                "fssaiLicense",
                "storageCapacity",
                "emergencyContact"
            ];

            const retailerUpdates = {};
            allowedRetailerFields.forEach(f => {
                if (req.body[f] !== undefined) {
                    retailerUpdates[f] = req.body[f];
                }
            });

            /* ---------- UPDATE RetailerProfile ---------- */

            await RetailerProfile.findOneAndUpdate(
                { roleId },
                { $set: retailerUpdates },
                { new: true, upsert: true }
            );

            /* ---------- ALSO UPDATE RoleIdentity CONTACT ---------- */

            if (req.body.emergencyContact !== undefined) {
                await RoleIdentity.findOneAndUpdate(
                    { roleId },
                    { $set: { emergencyContact: req.body.emergencyContact } }
                );
            }

            /* ===== Address & Pincode (Profile collection) ===== */
            const profileUpdates = {};

            if (req.body.address !== undefined) {
                profileUpdates.address = req.body.address;
            }

            if (req.body.pincode !== undefined) {
                profileUpdates.pincode = req.body.pincode;
            }

            // ✅ Update / create Profile only if needed
            if (Object.keys(profileUpdates).length > 0) {
                await Profile.findOneAndUpdate(
                    { roleId },
                    {
                        $set: {
                            ...profileUpdates,
                            role: user.role,
                            location: user.location
                        }
                    },
                    { upsert: true }
                );
            }

            // ✅ Keep response simple (frontend doesn’t rely on body)
            return res.json({ message: "Retailer profile updated successfully" });
        }

        /* ---------- ADMIN UPDATE ---------- */
        if (user.role === "ADMIN") {
            const allowedAdminFields = [
                "name",
                "organization",
                "location",
                "department",
                "designation",
                "officeContact",
                "emergencyContact"
            ];

            const adminUpdates = {};
            allowedAdminFields.forEach(f => {
                if (req.body[f] !== undefined) adminUpdates[f] = req.body[f];
            });

            const updatedAdmin = await RoleIdentity.findOneAndUpdate(
                { roleId },
                { $set: adminUpdates },
                { new: true, runValidators: true }
            ).select("-password -resetToken -resetTokenExpiry");

            return res.json(updatedAdmin);
        }

        /* ---------- FARMER / TRANSPORTER BASE UPDATE (RoleIdentity) ---------- */
        const allowedFields = [
            "name",
            "organization",
            "vehicleNumber",
            "vehicleType",
            "capacity",
            "warehouseCapacity",
            "licenseNo",
            "licenseExpiry",
            "rcBook",
            "insuranceTill",
            "preferredRoutes",
            "emergencyContact"
        ];

        const updates = {};
        allowedFields.forEach(f => {
            if (req.body[f] !== undefined) updates[f] = req.body[f];
        });

        const updatedUser = await RoleIdentity.findOneAndUpdate(
            { roleId },
            { $set: updates },
            { new: true, runValidators: true }
        ).select("-password -resetToken -resetTokenExpiry");

        /* ---------- FARMER / TRANSPORTER PROFILE UPDATE (Profile) ---------- */
        const profileUpdates = {};

        if (req.body.address !== undefined) profileUpdates.address = req.body.address;
        if (req.body.pincode !== undefined) profileUpdates.pincode = req.body.pincode;

        if (Object.keys(profileUpdates).length > 0) {
            await Profile.findOneAndUpdate(
                { roleId },
                {
                    $set: {
                        ...profileUpdates,
                        role: user.role,
                        location: user.location
                    }
                },
                { upsert: true }
            );
        }

        return res.json(updatedUser);

    } catch (err) {
        console.error("PROFILE UPDATE ERROR:", err);
        return res.status(500).json({ message: "Update failed" });
    }
};
