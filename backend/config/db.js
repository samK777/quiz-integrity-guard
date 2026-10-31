
const { Pool } = require("pg");

const isTestMode = process.env.NODE_ENV === "test";
const testDatabase = process.env.TEST_DB_NAME || "quiz_integrity_guard_test";
if (isTestMode && (!/(^|[_-])test($|[_-])/i.test(testDatabase) || /(^|[_-])prod(uction)?($|[_-])/i.test(testDatabase))) {
    throw new Error("Tests require a dedicated database name containing 'test' and must never target production.");
}

const pool = new Pool({
    host: isTestMode ? process.env.TEST_DB_HOST || process.env.DB_HOST || "localhost" : process.env.DB_HOST || "localhost",
    port: isTestMode ? process.env.TEST_DB_PORT || process.env.DB_PORT || 5432 : process.env.DB_PORT || 5432,
    user: isTestMode ? process.env.TEST_DB_USER || process.env.DB_USER || "samriddhikapoor" : process.env.DB_USER || "samriddhikapoor",
    password: isTestMode ? process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD : process.env.DB_PASSWORD,
    database: isTestMode ? testDatabase : process.env.DB_NAME || "quiz_integrity_guard"
});

module.exports = pool;
