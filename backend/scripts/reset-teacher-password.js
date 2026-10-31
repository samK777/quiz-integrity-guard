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
        const email = (await prompt.question("Teacher email: ")).trim().toLowerCase();
        prompt.close();
        if (email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Enter a valid email of at most 150 characters.");
        }

        const password = await promptHidden("New password (input hidden): ");
        const confirmation = await promptHidden("Confirm new password (input hidden): ");
        if (password !== confirmation) throw new Error("Passwords did not match; no account was changed.");
        if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
            throw new Error("Password must be at least 8 characters and no more than 72 UTF-8 bytes.");
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            "UPDATE users SET password_hash = $1 WHERE lower(email) = $2 AND role = 'teacher' RETURNING email",
            [passwordHash, email]
        );
        if (result.rowCount !== 1) throw new Error("No teacher account found for that email; no account was changed.");
        console.log(`Backend password updated for ${result.rows[0].email}. Set the same password in Firebase to keep portal teacher login working.`);
    } finally {
        prompt.close();
        await pool.end();
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
