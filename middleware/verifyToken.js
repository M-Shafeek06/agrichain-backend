const jwt = require("jsonwebtoken");

module.exports = function verifyToken(req, res, next) {

    const authHeader = req.headers.authorization;
    const roleIdHeader = req.headers["x-role-id"];

    /* ================= JWT (PRIMARY FOR DEPLOYMENT) ================= */
    if (authHeader && authHeader.startsWith("Bearer ")) {
        try {
            const token = authHeader.split(" ")[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            req.user = decoded;
            return next();

        } catch (err) {
            return res.status(401).json({
                message: "Invalid or expired token"
            });
        }
    }

    /* ================= FALLBACK (FOR YOUR SYSTEM) ================= */
    if (roleIdHeader) {
        req.user = {
            roleId: roleIdHeader,
            role: roleIdHeader.split("-")[0]
        };
        return next();
    }

    return res.status(401).json({
        message: "Access denied. Authentication required"
    });
};