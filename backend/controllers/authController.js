const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createToken(user) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error("JWT_SECRET is not configured");
    return jwt.sign({ sub: String(user.id) }, secret, { expiresIn: process.env.JWT_EXPIRES_IN || "1d" });
}

function publicUser(row) {
    return { id: row.id, name: row.name, email: row.email, role: row.role };
}

async function register(req, res) {
    const { name, email, password, role } = req.body || {};
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100 ||
        typeof email !== "string" || email.trim().length > 150 || !emailPattern.test(email.trim()) ||
        typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
        return res.status(400).json({ error: "Provide a name, valid email, and password of 8–72 characters." });
    }

    // Public registration is deliberately limited to student accounts. Teacher accounts
    // should be provisioned through a trusted administrative workflow.
    if (role !== undefined && role !== "student") {
        return res.status(400).json({ error: "Only student accounts can be created through registration." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    try {
        const result = await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ($1, $2, $3, 'student')
             RETURNING id, name, email, role`,
            [name.trim(), normalizedEmail, passwordHash]
        );
        const user = publicUser(result.rows[0]);
        return res.status(201).json({ user, token: createToken(user) });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ error: "An account with this email already exists." });
        throw error;
    }
}

async function login(req, res) {
    const { email, password } = req.body || {};
    if (typeof email !== "string" || !emailPattern.test(email.trim()) || email.trim().length > 150 ||
        typeof password !== "string" || Buffer.byteLength(password, "utf8") > 72) {
        return res.status(400).json({ error: "Email and password are required." });
    }
    const result = await pool.query(
        "SELECT id, name, email, password_hash, role FROM users WHERE email = $1 LIMIT 1",
        [email.trim().toLowerCase()]
    );
    const row = result.rows[0];
    const valid = row && await bcrypt.compare(password, row.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid email or password." });
    const user = publicUser(row);
    return res.json({ user, token: createToken(user) });
}

async function me(req, res) {
    const result = await pool.query(
        "SELECT id, name, email, role FROM users WHERE id = $1 LIMIT 1",
        [req.user.id]
    );
    if (!result.rows[0]) return res.status(401).json({ error: "Account no longer exists." });
    return res.json({ user: publicUser(result.rows[0]) });
}

module.exports = { register, login, me };
