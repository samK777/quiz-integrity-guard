require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

function requiredEnv(name) {
    const value = process.env[name];
    if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be set in backend/.env.`);
    return value.trim();
}

async function main() {
    if (process.env.NODE_ENV === "production" || /(^|[-_])prod(uction)?($|[-_])/i.test(process.env.DB_NAME || "")) {
        throw new Error("Refusing to create a test student in a production environment.");
    }
    const name = requiredEnv("TEST_STUDENT_NAME");
    const email = requiredEnv("TEST_STUDENT_EMAIL").toLowerCase();
    const password = requiredEnv("TEST_STUDENT_PASSWORD");
    if (name.length < 2 || name.length > 100) throw new Error("TEST_STUDENT_NAME must be 2–100 characters.");
    if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("TEST_STUDENT_EMAIL must be a valid email of at most 150 characters.");
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) throw new Error("TEST_STUDENT_PASSWORD must be 8–72 UTF-8 bytes.");

    const inserted = await pool.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'student')
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [name, email, await bcrypt.hash(password, 12)]
    );
    if (inserted.rowCount) {
        console.log(`Development test student created (${email}); password stored as a bcrypt hash.`);
        return;
    }
    const existing = await pool.query("SELECT role FROM users WHERE email = $1 LIMIT 1", [email]);
    if (existing.rows[0]?.role === "student") {
        console.log(`Development test student already exists (${email}); name and password were not changed.`);
        return;
    }
    throw new Error(`An account with ${email} already exists with a different role; no account was changed.`);
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
}).finally(() => pool.end());
