require("dotenv").config();

const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const cors = require("cors");
const pool = require("./config/db");
const authRoutes = require("./routes/auth");
const quizRoutes = require("./routes/quizzes");
const attemptRoutes = require("./routes/attempts");
const batchRoutes = require("./routes/batches");
const { setSocketServer } = require("./realtime/events");

const app = express();
const allowedOrigins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map(value => value.trim()).filter(Boolean)
    : ["http://localhost:3000", "http://127.0.0.1:5500", "http://localhost:5000", "http://127.0.0.1:5000", "http://localhost:5005", "http://127.0.0.1:5005"];
const extensionId = process.env.CHROME_EXTENSION_ID?.trim();
if (extensionId && /^[a-p]{32}$/.test(extensionId)) {
    allowedOrigins.push(`chrome-extension://${extensionId}`);
}
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.status(200).json({ status: "success", message: "Quiz Integrity Guard backend is running!", database: "connected" });
    } catch (error) {
        console.error("Database connection error:", error.message);
        res.status(500).json({ status: "error", database: "disconnected" });
    }
});

app.use("/api/auth", authRoutes);
app.use("/api/quizzes", quizRoutes);
app.use("/api/attempts", attemptRoutes);
app.use("/api/batches", batchRoutes);

app.use((err, req, res, next) => {
    console.error("Request error:", {
    message: err.message,
    code: err.code,
    detail: err.detail,
    constraint: err.constraint,
    stack: err.stack
});
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Request body must be valid JSON." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Request body is too large." });
    return res.status(500).json({ error: "An unexpected server error occurred." });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins } });

io.use(async (socket, next) => {
    const authToken = socket.handshake.auth?.token;
    const header = socket.handshake.headers.authorization || "";
    const bearerToken = /^Bearer\s+(.+)$/i.exec(header)?.[1];
    const token = typeof authToken === "string" ? authToken : bearerToken;
    if (!token) return next(new Error("Authentication required."));

    try {
        const claims = jwt.verify(token, process.env.JWT_SECRET);
        const result = await pool.query(
            "SELECT id, name, email, role FROM users WHERE id = $1 LIMIT 1",
            [claims.sub]
        );
        const user = result.rows[0];
        if (!user || user.role !== "teacher") return next(new Error("Teacher access required."));
        socket.data.user = user;
        socket.data.tokenExpiresAt = claims.exp ? claims.exp * 1000 : null;
        return next();
    } catch (error) {
        return next(new Error("Invalid or expired authentication token."));
    }
});

io.on("connection", socket => {
    socket.join("teachers");
    if (socket.data.tokenExpiresAt) {
        const remainingMs = socket.data.tokenExpiresAt - Date.now();
        if (remainingMs <= 0) return socket.disconnect(true);
        const expiryTimer = setTimeout(() => socket.disconnect(true), remainingMs);
        socket.once("disconnect", () => clearTimeout(expiryTimer));
    }
});
setSocketServer(io);

const PORT = process.env.PORT || 5050;
if (require.main === module) {
    if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET, "utf8") < 32) {
        console.error("JWT_SECRET must be set to at least 32 bytes. Copy backend/.env.example and configure a strong secret.");
        process.exit(1);
    }
    server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

module.exports = app;
module.exports.server = server;
module.exports.io = io;
