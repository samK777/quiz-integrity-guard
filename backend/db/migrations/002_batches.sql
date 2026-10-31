-- Add teacher-managed student batches. Existing application tables and rows are untouched.
BEGIN;

CREATE TABLE batches (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT batches_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX batches_name_lower_unique ON batches (lower(name));
CREATE INDEX idx_batches_created_by ON batches (created_by);

CREATE TABLE batch_students (
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT batch_students_pkey PRIMARY KEY (batch_id, student_id)
);

CREATE INDEX idx_batch_students_student_id ON batch_students (student_id);

COMMIT;
