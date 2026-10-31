require("dotenv").config();
const readline = require("node:readline/promises");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

function promptHidden(prompt) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
        throw new Error("Run this command in an interactive Terminal window.");
    }
    process.stdout.write(prompt);
    process.stdin.setEncoding("utf8");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    return new Promise((resolve, reject) => {
        let value = "";
        function finish(error) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener("data", onData);
            process.stdout.write("\n");
            if (error) reject(error); else resolve(value);
        }
        function onData(character) {
            if (character === "\u0003") return finish(new Error("Cancelled."));
            if (character === "\r" || character === "\n") return finish();
            if (character === "\u007f" || character === "\b") {
                value = value.slice(0, -1);
                return;
            }
            value += character;
        }
        process.stdin.on("data", onData);
    });
}

async function main() {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        const name = (await prompt.question("Teacher name: ")).trim();
        const email = (await prompt.question("Teacher email: ")).trim().toLowerCase();
        prompt.close();
        const password = await promptHidden("Teacher password (input hidden): ");

        if (name.length < 2 || name.length > 100) throw new Error("Name must be 2–100 characters.");
        if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email of at most 150 characters.");
        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) throw new Error("Password must be 8–72 UTF-8 bytes.");

        const existing = await pool.query("SELECT role FROM users WHERE email = $1 LIMIT 1", [email]);
        if (existing.rows[0]) throw new Error(`An account with that email already exists (${existing.rows[0].role}); no account was changed.`);
        const passwordHash = await bcrypt.hash(password, 12);
        await pool.query(
            "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'teacher')",
            [name, email, passwordHash]
        );
        console.log(`Teacher account created for ${email}. Use the same email and password for Firebase teacher login.`);
    } finally {
        prompt.close();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
