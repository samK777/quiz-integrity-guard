require("../server"); // Loads local .env before the database and JWT modules are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../config/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const studentEmail = `qig-test-student-${suffix}@example.com`;
const teacherEmail = `qig-test-teacher-${suffix}@example.com`;
let apiServer;
let roleServer;
let apiBase;
let studentId;
let teacherId;

async function post(path, body) {
    return fetch(`${apiBase}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
}

async function tokenRequest(url, token) {
    return fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

test("authentication works end to end", async () => {
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32,
        "set a JWT_SECRET of at least 32 bytes in backend/.env");

    apiServer = await new Promise((resolve, reject) => {
        const server = app.listen(0, () => resolve(server));
        server.once("error", reject);
    });
    apiBase = `http://127.0.0.1:${apiServer.address().port}`;

    try {
        const health = await fetch(`${apiBase}/api/health`);
        assert.equal(health.status, 200);
        assert.equal((await health.json()).database, "connected");

        const invalid = await post("/api/auth/register", { name: "A", email: "bad", password: "short" });
        assert.equal(invalid.status, 400);
        const roleEscalation = await post("/api/auth/register", {
            name: "Role Attack", email: studentEmail, password: "SecurePass42!", role: "teacher"
        });
        assert.equal(roleEscalation.status, 400);

        const registration = await post("/api/auth/register", {
            name: "Test Student", email: studentEmail, password: "SecurePass42!"
        });
        const registrationBody = await registration.json();
        assert.equal(registration.status, 201);
        assert.equal(registrationBody.user.role, "student");
        assert.equal(typeof registrationBody.token, "string");
        studentId = registrationBody.user.id;
        assert.equal(JSON.stringify(registrationBody).includes("password_hash"), false);

        const stored = await pool.query("SELECT password_hash FROM users WHERE email = $1", [studentEmail]);
        assert.match(stored.rows[0].password_hash, /^\$2[aby]\$12\$/);
        assert.equal(await bcrypt.compare("SecurePass42!", stored.rows[0].password_hash), true);

        const duplicate = await post("/api/auth/register", {
            name: "Test Student", email: studentEmail, password: "SecurePass42!"
        });
        assert.equal(duplicate.status, 409);

        const login = await post("/api/auth/login", { email: studentEmail, password: "SecurePass42!" });
        const loginBody = await login.json();
        assert.equal(login.status, 200);
        assert.equal(JSON.stringify(loginBody).includes("password_hash"), false);
        const claims = jwt.verify(loginBody.token, process.env.JWT_SECRET);
        assert.equal(String(claims.sub), String(studentId));

        const wrongPassword = await post("/api/auth/login", { email: studentEmail, password: "WrongPass42!" });
        assert.equal(wrongPassword.status, 401);
        const unknownUser = await post("/api/auth/login", { email: "missing@example.com", password: "NoSuchPass42!" });
        assert.equal(unknownUser.status, 401);
        assert.deepEqual(await unknownUser.json(), { error: "Invalid email or password." });

        const me = await tokenRequest(`${apiBase}/api/auth/me`, loginBody.token);
        const meBody = await me.json();
        assert.equal(me.status, 200);
        assert.equal(String(meBody.user.id), String(studentId));
        assert.equal("password_hash" in meBody.user, false);
        assert.equal((await fetch(`${apiBase}/api/auth/me`)).status, 401);
        assert.equal((await tokenRequest(`${apiBase}/api/auth/me`, "not-a-jwt")).status, 401);
        const expired = jwt.sign({ sub: String(studentId) }, process.env.JWT_SECRET, { expiresIn: -1 });
        assert.equal((await tokenRequest(`${apiBase}/api/auth/me`, expired)).status, 401);

        const roleApp = express();
        roleApp.get("/student", requireAuth, requireRole("student"), (req, res) => res.sendStatus(204));
        roleApp.get("/teacher", requireAuth, requireRole("teacher"), (req, res) => res.sendStatus(204));
        roleServer = await new Promise((resolve, reject) => {
            const server = roleApp.listen(0, () => resolve(server));
            server.once("error", reject);
        });
        const roleBase = `http://127.0.0.1:${roleServer.address().port}`;
        assert.equal((await tokenRequest(`${roleBase}/student`, loginBody.token)).status, 204);
        assert.equal((await tokenRequest(`${roleBase}/teacher`, loginBody.token)).status, 403);

        const hash = await bcrypt.hash("TeacherTest42!", 12);
        const inserted = await pool.query(
            "INSERT INTO users (name, email, password_hash, role) VALUES ('Test Teacher', $1, $2, 'teacher') RETURNING id",
            [teacherEmail, hash]
        );
        teacherId = inserted.rows[0].id;
        const teacherToken = jwt.sign({ sub: String(teacherId) }, process.env.JWT_SECRET, { expiresIn: "1m" });
        assert.equal((await tokenRequest(`${roleBase}/teacher`, teacherToken)).status, 204);
    } finally {
        if (roleServer) await new Promise(resolve => roleServer.close(resolve));
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        await pool.query("DELETE FROM users WHERE email = ANY($1::varchar[])", [[studentEmail, teacherEmail]]);
        await pool.end();
    }
});
