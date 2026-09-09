-- SmartPrinter Agent local SQLite schema.
-- This database is a WORKING QUEUE/CACHE, not a second source of truth - on any conflict
-- with the cloud, the cloud wins and the agent reconciles (see JobProcessor.ReconcileAsync).

CREATE TABLE IF NOT EXISTS print_jobs (
    print_job_id        TEXT PRIMARY KEY,        -- matches Supabase print_jobs.id
    idempotency_key      TEXT NOT NULL UNIQUE,
    printer_id           TEXT NOT NULL,
    printer_name         TEXT,
    storage_path         TEXT NOT NULL,
    status                TEXT NOT NULL CHECK (status IN (
                              'queued','claimed','downloading','downloaded',
                              'printing','completed','failed','cancelled')),
    options_json          TEXT NOT NULL DEFAULT '{}',
    local_file_path       TEXT,
    spooler_job_id        INTEGER,
    retry_count           INTEGER NOT NULL DEFAULT 0,
    last_error            TEXT,
    claimed_at            TEXT,
    downloaded_at         TEXT,
    printed_at            TEXT,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_print_jobs_status ON print_jobs(status);

CREATE TABLE IF NOT EXISTS local_job_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    print_job_id  TEXT NOT NULL,
    event_type    TEXT NOT NULL,
    detail        TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    FOREIGN KEY (print_job_id) REFERENCES print_jobs(print_job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_local_job_events_job ON local_job_events(print_job_id);

CREATE TABLE IF NOT EXISTS printer_cache (
    printer_name    TEXT PRIMARY KEY,
    driver_name     TEXT,
    port_name       TEXT,
    fingerprint     TEXT,
    is_authorized   INTEGER NOT NULL DEFAULT 0,
    remote_printer_id TEXT,
    last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS device_state (
    key           TEXT PRIMARY KEY,
    value         TEXT,
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key           TEXT PRIMARY KEY,
    value         TEXT,
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Seed default settings if this is a fresh database.
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_start', 'true');
INSERT OR IGNORE INTO settings (key, value) VALUES ('log_verbosity', 'Information');
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_seen_interval_seconds', '300');
