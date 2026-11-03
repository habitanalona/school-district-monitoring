-- Security Firewall & System Protection module — additive schema.
-- Creates all tables with the sec_ prefix avoided in favour of the spec names.
-- Idempotent (IF NOT EXISTS everywhere). Never alters existing SDMS tables.

-- ---------------------------------------------------------------------------
-- SuperAdmin identities. Completely separate from public.users: no foreign key
-- on purpose, so the firewall identity survives user-table incidents and can
-- never be granted through User Management.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS superadmin_users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    full_name     TEXT NOT NULL,
    email         TEXT,
    password_hash TEXT NOT NULL,
    totp_secret   TEXT,
    totp_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    failed_logins INT NOT NULL DEFAULT 0,
    locked_until  TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Firewall master switches plus lockdown. One row per key.
CREATE TABLE IF NOT EXISTS firewall_settings (
    id            BIGSERIAL PRIMARY KEY,
    key           TEXT NOT NULL UNIQUE,             -- db_write_protection | code_write_protection | maintenance_mode | security_lockdown
    enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    policy_note   TEXT NOT NULL DEFAULT '',
    updated_by    BIGINT REFERENCES superadmin_users(id),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS firewall_control_history (
    id           BIGSERIAL PRIMARY KEY,
    key          TEXT NOT NULL,
    previous     BOOLEAN,
    next         BOOLEAN NOT NULL,
    actor_id     BIGINT REFERENCES superadmin_users(id),
    actor_name   TEXT NOT NULL,
    reason       TEXT NOT NULL DEFAULT '',
    ip_address   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fw_history_key_time ON firewall_control_history (key, created_at DESC);

-- ---------------------------------------------------------------------------
-- Events: near-real-time stream of everything the monitoring engine observes.
-- Severity: informational | low | medium | high | critical
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_events (
    id             BIGSERIAL PRIMARY KEY,
    event_id       TEXT NOT NULL UNIQUE,            -- public UUID, e.g. SEV-...
    severity       TEXT NOT NULL DEFAULT 'informational',
    category       TEXT NOT NULL,                   -- auth | database | code | upload | network | firewall | system | recovery
    action         TEXT NOT NULL,                   -- e.g. DB_WRITE_REJECTED
    description    TEXT NOT NULL DEFAULT '',
    username       TEXT,
    user_role      TEXT,
    user_id        BIGINT,
    is_superadmin  BOOLEAN NOT NULL DEFAULT FALSE,
    ip_address     TEXT,
    ip_geolocation TEXT NOT NULL DEFAULT 'unknown', -- estimated only, never presented as verified
    user_agent     TEXT,
    request_method TEXT,
    endpoint       TEXT,
    db_table       TEXT,
    record_id      TEXT,
    file_name      TEXT,
    firewall_decision TEXT,                         -- allowed | rejected | monitored
    incident_id    BIGINT,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sec_events_time ON security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_severity ON security_events (severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sec_events_ip ON security_events (ip_address);
CREATE INDEX IF NOT EXISTS idx_sec_events_action ON security_events (action, created_at DESC);

-- ---------------------------------------------------------------------------
-- Incidents with lifecycle status.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_incidents (
    id            BIGSERIAL PRIMARY KEY,
    reference     TEXT NOT NULL UNIQUE,             -- INC-YYYY-NNNN
    severity      TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'new',      -- new | investigating | contained | recovery_in_progress | resolved | closed
    source_event_id BIGINT REFERENCES security_events(id),
    source_ip     TEXT,
    actor_hint    TEXT,
    opened_by     TEXT NOT NULL DEFAULT 'system',
    assigned_to   BIGINT REFERENCES superadmin_users(id),
    containment   JSONB NOT NULL DEFAULT '{}'::jsonb,
    resolution    TEXT,
    opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at     TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON security_incidents (status, severity);

-- Immutable-style audit trail. SuperAdmin-only writes; no UPDATE/DELETE grants
-- are given to application roles other than the security service itself.
CREATE TABLE IF NOT EXISTS security_audit_logs (
    id               BIGSERIAL PRIMARY KEY,
    event_id         TEXT NOT NULL UNIQUE,
    occurred_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_id         BIGINT REFERENCES superadmin_users(id),
    actor_name       TEXT,
    action           TEXT NOT NULL,
    target_type      TEXT,
    target_id        TEXT,
    details          JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address       TEXT,
    previous_hash    TEXT,                          -- hash chain for tamper evidence
    entry_hash       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sec_audit_time ON security_audit_logs (occurred_at DESC);

-- Database activity observed by the write guard and the worker.
CREATE TABLE IF NOT EXISTS database_activity_logs (
    id            BIGSERIAL PRIMARY KEY,
    operation     TEXT NOT NULL,                    -- SELECT | INSERT | UPDATE | DELETE | DDL
    table_name    TEXT,
    authorized    BOOLEAN NOT NULL,
    actor         TEXT,
    source        TEXT NOT NULL DEFAULT 'application', -- application | security | worker
    sql_fingerprint TEXT,                           -- normalized statement, never raw values
    decision      TEXT NOT NULL,                    -- allowed | rejected
    reason        TEXT,
    duration_ms   INT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_db_activity_time ON database_activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_activity_decision ON database_activity_logs (decision, operation);

-- Code integrity records: per-file baseline + verification results.
CREATE TABLE IF NOT EXISTS code_integrity_records (
    id            BIGSERIAL PRIMARY KEY,
    file_path     TEXT NOT NULL UNIQUE,
    sha256        TEXT NOT NULL,
    size_bytes    BIGINT,
    status        TEXT NOT NULL DEFAULT 'verified', -- verified | modified | missing | added
    last_verified_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_code_integrity_status ON code_integrity_records (status);

-- Generic baselines (code file hashes, config manifests, checksum roots).
CREATE TABLE IF NOT EXISTS security_baselines (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL,                      -- code_tree | config | manifest
    content     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by  BIGINT REFERENCES superadmin_users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upload inspection results for every uploaded file (all upload paths).
CREATE TABLE IF NOT EXISTS file_upload_security_logs (
    id             BIGSERIAL PRIMARY KEY,
    original_name  TEXT,
    stored_name    TEXT,
    username       TEXT,
    user_role      TEXT,
    ip_address     TEXT,
    file_size      BIGINT,
    declared_mime  TEXT,
    detected_mime  TEXT,
    destination    TEXT,
    scan_result    TEXT NOT NULL DEFAULT 'pending', -- clean | rejected | pending | error
    rejection_reason TEXT,
    action_taken   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_upload_logs_time ON file_upload_security_logs (created_at DESC);

-- Periodic health snapshots written by the background worker.
CREATE TABLE IF NOT EXISTS system_health_records (
    id           BIGSERIAL PRIMARY KEY,
    check_name   TEXT NOT NULL,
    status       TEXT NOT NULL,                     -- healthy | degraded | down | unknown
    latency_ms   INT,
    message      TEXT,
    details      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_time ON system_health_records (check_name, created_at DESC);

-- SuperAdmin-facing alerts (dashboard bell + optional email hooks).
CREATE TABLE IF NOT EXISTS security_alerts (
    id          BIGSERIAL PRIMARY KEY,
    severity    TEXT NOT NULL,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL DEFAULT '',
    source      TEXT,                               -- event/incident id reference
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    read_by     BIGINT REFERENCES superadmin_users(id),
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_read ON security_alerts (is_read, created_at DESC);

-- Backup registry. Files live outside the app directory; this is the ledger.
CREATE TABLE IF NOT EXISTS backup_records (
    id           BIGSERIAL PRIMARY KEY,
    label        TEXT NOT NULL,
    file_path    TEXT NOT NULL,
    file_size    BIGINT,
    kind         TEXT NOT NULL DEFAULT 'database',  -- database | logs | code
    created_by   BIGINT REFERENCES superadmin_users(id),
    created_by_name TEXT,
    status       TEXT NOT NULL DEFAULT 'pending',   -- pending | verified | failed
    verified_at  TIMESTAMPTZ,
    verified_by  BIGINT REFERENCES superadmin_users(id),
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Recovery sessions: full lifecycle of an emergency recovery.
CREATE TABLE IF NOT EXISTS recovery_sessions (
    id              BIGSERIAL PRIMARY KEY,
    reference       TEXT NOT NULL UNIQUE,           -- REC-YYYY-NNNN
    trigger_event   TEXT NOT NULL DEFAULT 'manual', -- manual | automatic:<action>
    incident_id     BIGINT REFERENCES security_incidents(id),
    status          TEXT NOT NULL DEFAULT 'detect', -- detect | contain | preserve | assess | verify_backup | restore | verify_integrity | reactivate | completed | aborted
    recovery_point  TIMESTAMPTZ,
    backup_id       BIGINT REFERENCES backup_records(id),
    affected_notes  TEXT,
    progress_notes  JSONB NOT NULL DEFAULT '[]'::jsonb,
    activated_by    BIGINT REFERENCES superadmin_users(id),
    activated_by_name TEXT,
    activated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

-- Approved maintenance sessions: an audit trail for authorized OFF-switch work.
CREATE TABLE IF NOT EXISTS approved_maintenance_sessions (
    id           BIGSERIAL PRIMARY KEY,
    purpose      TEXT NOT NULL,
    scope        TEXT NOT NULL DEFAULT '',          -- e.g. database | code
    approved_by  BIGINT REFERENCES superadmin_users(id),
    approved_by_name TEXT NOT NULL,
    switch_key   TEXT NOT NULL,
    active_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
    active_until TIMESTAMPTZ,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the four master switches (defaults: everything OFF, fully protected-free).
INSERT INTO firewall_settings (key, enabled, policy_note)
VALUES
  ('db_write_protection',    FALSE, 'Reject unauthorized database writes at the SQL choke point.'),
  ('code_write_protection',  FALSE, 'Detect and alert on unauthorized application file changes.'),
  ('maintenance_mode',       FALSE, 'Restrict ordinary users while authorized maintenance runs.'),
  ('security_lockdown',      FALSE, 'Emergency freeze of database/code changes after critical incidents.')
ON CONFLICT (key) DO NOTHING;
