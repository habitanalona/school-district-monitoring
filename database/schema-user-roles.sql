-- Structured name parts for self-registration. users.full_name stays the
-- canonical display value so existing reports and joins keep working.
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS middle_name VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(80);

-- One account may carry several roles (for example teacher + class adviser +
-- coordinator). users.role remains the primary role used for approval routing
-- and legacy scope checks; permissions are the union of every row here.
CREATE TABLE IF NOT EXISTS user_roles (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(32) NOT NULL CHECK (
    role IN (
      'system_admin', 'district_admin', 'psds', 'school_head', 'teacher',
      'coordinator', 'nt', 'adviser', 'learner', 'staff'
    )
  ),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON user_roles (role);

INSERT INTO user_roles (user_id, role)
SELECT id, role FROM users
ON CONFLICT (user_id, role) DO NOTHING;
