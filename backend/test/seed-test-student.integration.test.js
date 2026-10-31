require("../server");
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const pool = require("../config/db");

const email = `qig-seed-${Date.now().toString(36)}@example.com`;
const script = path.join(__dirname, "../scripts/seed-test-student.js");

test("development test-student seed is safe and repeatable", async () => {
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32,
        "set a JWT_SECRET of at least 32 bytes in backend/.env");
    const password = "SeedStudentPass42!";
    const runSeed = overrides => spawnSync(process.execPath, [script], {
        encoding: "utf8",
        env: {
            ...process.env,
            NODE_ENV: "development",
            DB_HOST: process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost",
            DB_PORT: process.env.TEST_DB_PORT || process.env.DB_PORT || "5432",
            DB_USER: process.env.TEST_DB_USER || process.env.DB_USER || "samriddhikapoor",
            DB_PASSWORD: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || "",
            DB_NAME: process.env.TEST_DB_NAME || "quiz_integrity_guard_test",
            TEST_STUDENT_NAME: "Seed Test Student",
            TEST_STUDENT_EMAIL: email,
            TEST_STUDENT_PASSWORD: password,
            ...overrides
        }
    });
    try {
        const production = runSeed({ NODE_ENV: "production" });
        assert.notEqual(production.status, 0);
        assert.match(production.stderr, /Refusing to create a test student/);
        assert.equal((await pool.query("SELECT id FROM users WHERE email = $1", [email])).rowCount, 0);

        const first = runSeed({});
        assert.equal(first.status, 0, first.stderr);
        assert.match(first.stdout, /created/);
        const row = (await pool.query("SELECT id, name, email, role, password_hash FROM users WHERE email = $1", [email])).rows[0];
        assert.ok(row);
        assert.equal(row.role, "student");
        assert.notEqual(row.password_hash, password);
        assert.match(row.password_hash, /^\$2[aby]\$/);
        assert.equal(await bcrypt.compare(password, row.password_hash), true);
        const originalHash = row.password_hash;

        const repeated = runSeed({ TEST_STUDENT_PASSWORD: "DifferentPass42!" });
        assert.equal(repeated.status, 0, repeated.stderr);
        assert.match(repeated.stdout, /already exists/);
        const afterRepeat = (await pool.query("SELECT password_hash FROM users WHERE email = $1", [email])).rows[0];
        assert.equal(afterRepeat.password_hash, originalHash);
        assert.equal(await bcrypt.compare(password, afterRepeat.password_hash), true);
    } finally {
        await pool.query("DELETE FROM users WHERE email = $1", [email]);
        await pool.end();
    }
});
