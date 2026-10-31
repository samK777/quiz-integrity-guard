-- Bootstrap migration for a new database only. The existing Quiz Integrity Guard
-- database already has this table; do not apply this file to that database.
-- This definition matches the users table inspected on 2026-10-30.
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
