const jwt = require("jsonwebtoken");
const pool = require("../config/db");

async function requireAuth(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "");
    if (!match) return res.status(401).json({ error: "Authentication required." });
    try {
        const payload = jwt.verify(match[1], process.env.JWT_SECRET);
        const result = await pool.query(
            "SELECT id, name, email, role FROM users WHERE id = $1 LIMIT 1",
            [payload.sub]
        );
        if (!result.rows[0]) return res.status(401).json({ error: "Invalid or expired token." });
        req.user = result.rows[0];
        return next();
    } catch (error) {
        if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Invalid or expired token." });
        }
        return next(error);
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ error: "You do not have permission to access this resource." });
        }
        return next();
    };
}

module.exports = { requireAuth, requireRole };
