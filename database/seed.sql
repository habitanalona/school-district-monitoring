-- Development seed data for the School District Monitoring System.
-- All accounts and records are fictional demonstration data.
-- Passwords are bcrypt hashes (cost 12). See README for demo credentials.

BEGIN;

INSERT INTO districts (
  district_name, district_code, address, contact_email,
  psds_one_name, psds_one_email, psds_one_phone,
  psds_two_name, psds_two_email, psds_two_phone
)
VALUES
  ('North Valley School District', 'NVD', 'District Office, 1 Education Circle, North Valley', 'north.valley@example.com',
   'Rowena M. Salazar', 'rowena.salazar@example.com', '+63 2 8451 0110',
   'Alvin D. Reyes', 'alvin.reyes@example.com', '+63 2 8451 0111'),
  ('Riverside School District', 'RSD', 'District Office, 24 River Road, Riverside', 'riverside@example.com',
   'Marlon C. Dela Cruz', 'marlon.delacruz@example.com', '+63 2 8462 0210',
   'Jocelyn T. Ramos', 'jocelyn.ramos@example.com', '+63 2 8462 0211'),
  ('Southgate School District', 'SGD', 'District Office, 8 Southgate Plaza, Southgate', 'southgate@example.com',
   'Editha P. Lopez', 'editha.lopez@example.com', '+63 2 8473 0310',
   'Reynaldo S. Cruz', 'reynaldo.cruz@example.com', '+63 2 8473 0311')
ON CONFLICT (district_code) DO NOTHING;

UPDATE districts d
SET psds_one_name = COALESCE(d.psds_one_name, v.psds_one_name),
    psds_one_email = COALESCE(d.psds_one_email, v.psds_one_email),
    psds_one_phone = COALESCE(d.psds_one_phone, v.psds_one_phone),
    psds_two_name = COALESCE(d.psds_two_name, v.psds_two_name),
    psds_two_email = COALESCE(d.psds_two_email, v.psds_two_email),
    psds_two_phone = COALESCE(d.psds_two_phone, v.psds_two_phone)
FROM (VALUES
  ('NVD', 'Rowena M. Salazar', 'rowena.salazar@example.com', '+63 2 8451 0110', 'Alvin D. Reyes', 'alvin.reyes@example.com', '+63 2 8451 0111'),
  ('RSD', 'Marlon C. Dela Cruz', 'marlon.delacruz@example.com', '+63 2 8462 0210', 'Jocelyn T. Ramos', 'jocelyn.ramos@example.com', '+63 2 8462 0211'),
  ('SGD', 'Editha P. Lopez', 'editha.lopez@example.com', '+63 2 8473 0310', 'Reynaldo S. Cruz', 'reynaldo.cruz@example.com', '+63 2 8473 0311')
) AS v(district_code, psds_one_name, psds_one_email, psds_one_phone, psds_two_name, psds_two_email, psds_two_phone)
WHERE d.district_code = v.district_code;

-- Earlier builds seeded North Valley under the legacy code "BWD". Merge that
-- row into NVD so schools, users, and approvers stay in one district.
DO $$
DECLARE
  legacy_id BIGINT;
  north_id BIGINT;
BEGIN
  SELECT id INTO legacy_id FROM districts WHERE district_code = 'BWD' LIMIT 1;
  SELECT id INTO north_id FROM districts WHERE district_code = 'NVD' LIMIT 1;
  IF legacy_id IS NOT NULL AND north_id IS NOT NULL AND legacy_id <> north_id THEN
    UPDATE schools SET district_id = north_id WHERE district_id = legacy_id;
    UPDATE users SET district_id = north_id WHERE district_id = legacy_id;
    UPDATE announcements SET district_id = north_id WHERE district_id = legacy_id;
    UPDATE audit_logs SET district_id = north_id WHERE district_id = legacy_id;
    DELETE FROM districts WHERE id = legacy_id;
  END IF;
END $$;

INSERT INTO users (
  full_name, username, email, password_hash, role, district_id, school_id, is_active, approval_status
)
VALUES
  ('System Administrator', 'sysadmin', 'admin@example.com', '$2b$12$LHFoA0ghkcobPlB8g1We7.JYePnr4lbw9lvidrPqt9MuD6Hxhqz8q', 'system_admin', NULL, NULL, TRUE, 'active'),
  ('Alicia Navarro', 'northadmin', 'north.admin@example.com', '$2b$12$WHIkACIRFWsT6ydvhoXVjuhYMOSd2Jix3lISYr46xkY/n6JdHWrJa', 'district_admin', (SELECT id FROM districts WHERE district_code = 'NVD'), NULL, TRUE, 'active'),
  ('Benjie Ramos', 'northstaff', 'north.staff@example.com', '$2b$12$n03ZSUFH/E.K7BdwcOZAWeoGvU5fwjOBk0TgxDHKRBN8jdlce5JM.', 'staff', (SELECT id FROM districts WHERE district_code = 'NVD'), NULL, TRUE, 'active'),
  ('Carmen Villanueva', 'riversideadmin', 'riverside.admin@example.com', '$2b$12$cqrfSfaX3YLIkQF4OhoC..XyrKp75liNCesj1qfc42zNQOqNYn75G', 'district_admin', (SELECT id FROM districts WHERE district_code = 'RSD'), NULL, TRUE, 'active'),
  ('Daniel Mercado', 'southstaff', 'south.staff@example.com', '$2b$12$q55mVl5f5EkDqX37O7RhLudsYOgioxFPEg7I/dh3z00gUDa8Otmv.', 'staff', (SELECT id FROM districts WHERE district_code = 'SGD'), NULL, TRUE, 'active'),
  ('Teresita Ocampo', 'southadmin', 'south.admin@example.com', '$2b$12$WHIkACIRFWsT6ydvhoXVjuhYMOSd2Jix3lISYr46xkY/n6JdHWrJa', 'district_admin', (SELECT id FROM districts WHERE district_code = 'SGD'), NULL, TRUE, 'active'),
  ('Rowena M. Salazar', 'northpsds', 'rowena.salazar@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'psds', (SELECT id FROM districts WHERE district_code = 'NVD'), NULL, TRUE, 'active'),
  ('Marlon C. Dela Cruz', 'riversidepsds', 'marlon.delacruz@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'psds', (SELECT id FROM districts WHERE district_code = 'RSD'), NULL, TRUE, 'active'),
  ('Editha P. Lopez', 'southpsds', 'editha.lopez@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'psds', (SELECT id FROM districts WHERE district_code = 'SGD'), NULL, TRUE, 'active'),
  ('Pending PSDS Applicant', 'pendingpsds', 'pending.psds@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'psds', (SELECT id FROM districts WHERE district_code = 'NVD'), NULL, FALSE, 'pending')
ON CONFLICT (username) DO NOTHING;

INSERT INTO schools (school_code, school_name, school_type, address, district_id, school_head, contact_email, contact_phone, student_count, teacher_count, performance_score, status)
VALUES
  ('NES-001', 'Central Elementary School', 'Elementary School', '12 Mabini Street, San Isidro, North Valley', (SELECT id FROM districts WHERE district_code = 'NVD'), 'Maria L. Santos', 'central.es@example.com', '+63 2 8451 0101', 842, 38, 88.40, 'active'),
  ('NHS-001', 'North District National High School', 'High School', '88 Rizal Avenue, North Valley', (SELECT id FROM districts WHERE district_code = 'NVD'), 'Ramon P. Bautista', 'north.nhs@example.com', '+63 2 8451 0102', 1264, 56, 91.20, 'active'),
  ('NES-002', 'Southside Elementary School', 'Elementary School', '5 Sampaguita Lane, Southside, North Valley', (SELECT id FROM districts WHERE district_code = 'NVD'), 'Liza M. Mendoza', 'southside.es@example.com', '+63 2 8451 0103', 610, 28, 84.60, 'active'),
  ('INT-001', 'Riverside Integrated School', 'Integrated School', 'Km 7 River Road, Riverside, North Valley', (SELECT id FROM districts WHERE district_code = 'NVD'), 'Grace A. Villanueva', 'riverside.is@example.com', '+63 2 8451 0104', 973, 44, 87.80, 'active'),
  ('NHS-002', 'Westview National High School', 'High School', '3 Acacia Street, Westview, North Valley', (SELECT id FROM districts WHERE district_code = 'NVD'), 'Joel D. Aquino', 'westview.nhs@example.com', '+63 2 8451 0105', 1105, 49, 79.50, 'active'),
  ('NES-003', 'East District Elementary School', 'Elementary School', '21 Narra Street, East District, North Valley', (SELECT id FROM districts WHERE district_code = 'NVD'), 'Anne C. de Guzman', 'east.es@example.com', '+63 2 8451 0106', 536, 24, 76.20, 'active'),
  ('RES-101', 'Riverbend Elementary School', 'Elementary School', '14 Bayanihan Road, Riverside', (SELECT id FROM districts WHERE district_code = 'RSD'), 'Carlo M. Reyes', 'riverbend.es@example.com', '+63 2 8462 0201', 728, 32, 86.10, 'active'),
  ('RHS-101', 'Hillside National High School', 'High School', '7 Hillside Drive, Riverside', (SELECT id FROM districts WHERE district_code = 'RSD'), 'Teresa F. Lim', 'hillside.nhs@example.com', '+63 2 8462 0202', 1412, 61, 89.70, 'active'),
  ('INT-101', 'Lakeview Integrated School', 'Integrated School', '2 Lakeview Park, Riverside', (SELECT id FROM districts WHERE district_code = 'RSD'), 'Miguel S. Torres', 'lakeview.is@example.com', '+63 2 8462 0203', 1030, 47, 82.30, 'active'),
  ('RES-102', 'Greenfield Elementary School', 'Elementary School', '9 Greenfield Avenue, Riverside', (SELECT id FROM districts WHERE district_code = 'RSD'), 'Nora B. Castillo', 'greenfield.es@example.com', '+63 2 8462 0204', 468, 21, 74.80, 'active'),
  ('STH-101', 'Riverside Technical High School', 'Senior High School', '55 Vocational Road, Riverside', (SELECT id FROM districts WHERE district_code = 'RSD'), 'Dennis R. Garcia', 'riverside.tech@example.com', '+63 2 8462 0205', 880, 41, 90.50, 'active'),
  ('SES-201', 'Southgate Central Elementary School', 'Elementary School', '6 Plaza Street, Southgate', (SELECT id FROM districts WHERE district_code = 'SGD'), 'Evelyn P. Cruz', 'southgate.central@example.com', '+63 2 8473 0301', 932, 42, 85.90, 'active'),
  ('SHS-201', 'Southgate National High School', 'High School', '100 Education Avenue, Southgate', (SELECT id FROM districts WHERE district_code = 'SGD'), 'Ferdinand T. Ramos', 'southgate.nhs@example.com', '+63 2 8473 0302', 1530, 68, 92.10, 'active'),
  ('SIN-201', 'Meadowbrook Integrated School', 'Integrated School', '18 Meadowbrook Lane, Southgate', (SELECT id FROM districts WHERE district_code = 'SGD'), 'Cecilia M. Flores', 'meadowbrook.is@example.com', '+63 2 8473 0303', 784, 36, 83.40, 'active'),
  ('SES-202', 'Oakridge Elementary School', 'Elementary School', '4 Oakridge Road, Southgate', (SELECT id FROM districts WHERE district_code = 'SGD'), 'Paolo J. Navarro', 'oakridge.es@example.com', '+63 2 8473 0304', 515, 23, 71.60, 'inactive'),
  ('STH-201', 'Harborview Senior High School', 'Senior High School', '77 Harbor Drive, Southgate', (SELECT id FROM districts WHERE district_code = 'SGD'), 'Marites L. Domingo', 'harborview.shs@example.com', '+63 2 8473 0305', 1190, 53, 88.80, 'active')
ON CONFLICT (school_code) DO NOTHING;

-- School-linked accounts are seeded after schools exist so their school_id lookups resolve.
INSERT INTO users (
  full_name, username, email, password_hash, role, district_id, school_id, is_active, approval_status
)
VALUES
  ('Maria L. Santos', 'northhead', 'central.es@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'school_head', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), TRUE, 'active'),
  ('Liza M. Mendoza', 'northadviser', 'liza.mendoza@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'adviser', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), TRUE, 'active'),
  ('Paolo G. Rivera', 'northteacher', 'paolo.rivera@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'teacher', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), TRUE, 'active'),
  ('Marissa T. Bautista', 'northnt', 'marissa.bautista@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'nt', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), TRUE, 'active'),
  ('Joshua A. Lim', 'northlearner', 'joshua.lim@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'learner', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), TRUE, 'active'),
  ('Carlo M. Reyes', 'riversidehead', 'riverbend.es@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'school_head', (SELECT id FROM districts WHERE district_code = 'RSD'), (SELECT id FROM schools WHERE school_code = 'RES-101'), TRUE, 'active'),
  ('Nora B. Castillo', 'riversideadviser', 'greenfield.es@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'adviser', (SELECT id FROM districts WHERE district_code = 'RSD'), (SELECT id FROM schools WHERE school_code = 'RES-101'), TRUE, 'active'),
  ('Evelyn P. Cruz', 'southhead', 'southgate.central@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'school_head', (SELECT id FROM districts WHERE district_code = 'SGD'), (SELECT id FROM schools WHERE school_code = 'SES-201'), TRUE, 'active'),
  ('Cecilia M. Flores', 'southadviser', 'meadowbrook.is@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'adviser', (SELECT id FROM districts WHERE district_code = 'SGD'), (SELECT id FROM schools WHERE school_code = 'SES-201'), TRUE, 'active'),
  ('Pending School Head Applicant', 'pendinghead', 'pending.head@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'school_head', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), FALSE, 'pending'),
  ('Pending Teacher Applicant', 'pendingteacher', 'pending.teacher@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'teacher', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), FALSE, 'pending'),
  ('Pending Learner Applicant', 'pendinglearner', 'pending.learner@example.com', '$2b$12$sQlWzmn7KBY8tExluFTKyeH9eb5yEUzFM/7oNMI9fJ0X6.222.gEK', 'learner', (SELECT id FROM districts WHERE district_code = 'NVD'), (SELECT id FROM schools WHERE school_code = 'NES-001'), FALSE, 'pending')
ON CONFLICT (username) DO NOTHING;

INSERT INTO school_reports (school_id, reporting_period, report_type, submission_status, submitted_by, submitted_at, remarks)
SELECT s.id, v.reporting_period, v.report_type, v.submission_status,
       (SELECT id FROM users WHERE username = 'sysadmin'),
       v.submitted_at, v.remarks
FROM (VALUES
  ('NES-001', '2026-10', 'Monthly Enrollment', 'submitted', TIMESTAMPTZ '2026-10-18 09:15:00+08', 'Enrollment reconciled with the registrar.'),
  ('NHS-001', '2026-10', 'Monthly Enrollment', 'submitted', TIMESTAMPTZ '2026-10-18 10:05:00+08', 'Complete submission with grade-level breakdown.'),
  ('NES-002', '2026-10', 'Monthly Enrollment', 'pending', NULL::timestamptz, 'Awaiting registrar confirmation.'),
  ('INT-001', '2026-10', 'Monthly Enrollment', 'submitted', TIMESTAMPTZ '2026-10-19 08:40:00+08', 'Submitted on time.'),
  ('NHS-002', '2026-10', 'Monthly Enrollment', 'pending', NULL::timestamptz, 'Reminder sent to the school head.'),
  ('NES-003', '2026-10', 'Monthly Enrollment', 'late', TIMESTAMPTZ '2026-10-24 15:20:00+08', 'Submitted after the reporting deadline.'),
  ('RES-101', '2026-10', 'Monthly Enrollment', 'submitted', TIMESTAMPTZ '2026-10-17 13:30:00+08', 'Submitted on time.'),
  ('RHS-101', '2026-10', 'Monthly Enrollment', 'reviewed', TIMESTAMPTZ '2026-10-16 11:10:00+08', 'Reviewed and accepted by the district office.'),
  ('INT-101', '2026-10', 'Monthly Enrollment', 'pending', NULL::timestamptz, 'School head requested an extension.'),
  ('RES-102', '2026-10', 'Monthly Enrollment', 'late', TIMESTAMPTZ '2026-10-25 16:45:00+08', 'Follow-up required on enrollment variance.'),
  ('STH-101', '2026-10', 'Monthly Enrollment', 'submitted', TIMESTAMPTZ '2026-10-18 14:00:00+08', 'Complete submission.'),
  ('SES-201', '2026-10', 'Monthly Enrollment', 'submitted', TIMESTAMPTZ '2026-10-17 09:50:00+08', 'Submitted on time.'),
  ('SHS-201', '2026-10', 'Monthly Enrollment', 'reviewed', TIMESTAMPTZ '2026-10-16 10:20:00+08', 'Reviewed and accepted by the district office.'),
  ('SIN-201', '2026-10', 'Monthly Enrollment', 'pending', NULL::timestamptz, 'Awaiting updated learner list.'),
  ('SES-202', '2026-10', 'Monthly Enrollment', 'pending', NULL::timestamptz, 'School is inactive; report remains outstanding.'),
  ('STH-201', '2026-10', 'Monthly Enrollment', 'submitted', TIMESTAMPTZ '2026-10-20 09:05:00+08', 'Submitted on time.')
) AS v(school_code, reporting_period, report_type, submission_status, submitted_at, remarks)
JOIN schools s ON s.school_code = v.school_code
ON CONFLICT (school_id, reporting_period, report_type) DO NOTHING;

INSERT INTO school_reports (school_id, reporting_period, report_type, submission_status, submitted_by, submitted_at, remarks)
SELECT s.id, '2026-09', 'Monthly Enrollment',
       CASE WHEN s.id % 3 = 0 THEN 'submitted' ELSE 'reviewed' END,
       (SELECT id FROM users WHERE username = 'sysadmin'),
       TIMESTAMPTZ '2026-09-28 10:00:00+08',
       'September submission on file.'
FROM schools s
ON CONFLICT (school_id, reporting_period, report_type) DO NOTHING;

INSERT INTO school_enrollment (school_id, academic_year, student_count, grade_level)
SELECT s.id, '2026-2027',
       ROUND(s.student_count * v.weight)::integer,
       v.grade_level
FROM schools s
CROSS JOIN (VALUES
  ('Kindergarten', 0.12),
  ('Grades 1-3', 0.28),
  ('Grades 4-6', 0.25),
  ('Grades 7-10', 0.23),
  ('Grades 11-12', 0.12)
) AS v(grade_level, weight)
ON CONFLICT (school_id, academic_year, grade_level) DO NOTHING;

INSERT INTO announcements (title, content, created_by, district_id, published_at, status)
SELECT v.title, v.content, u.id, d.id, v.published_at, v.status
FROM (VALUES
  ('October monitoring window is now open',
   'All schools must submit their October enrollment and compliance updates through the district dashboard before October 25, 2026. School heads may coordinate with their district administrator for corrections.',
   'published', TIMESTAMPTZ '2026-10-01 08:00:00+08', NULL),
  ('District performance review schedule',
   'The quarterly performance review will take place on November 6, 2026. District administrators will receive a consolidated school comparison report two days before the session.',
   'published', TIMESTAMPTZ '2026-10-12 09:30:00+08', NULL),
  ('Reminder: keep school contact details current',
   'Please review each school record and update the school head, email address, and contact number when assignments change. Accurate contact details help the district office follow up on pending reports.',
   'published', TIMESTAMPTZ '2026-10-20 07:45:00+08', NULL),
  ('North Valley planning session (draft)',
   'The North Valley district office is preparing its 2027 school improvement planning session. This announcement is still in draft and is visible only to district administrators.',
   'draft', NULL, 'NVD')
) AS v(title, content, status, published_at, district_code)
JOIN users u ON u.username = 'sysadmin'
LEFT JOIN districts d ON d.district_code = v.district_code
WHERE NOT EXISTS (SELECT 1 FROM announcements a WHERE a.title = v.title);

INSERT INTO notifications (user_id, title, message, is_read, created_at)
SELECT u.id, v.title, v.message, v.is_read, v.created_at
FROM (VALUES
  ('sysadmin', '3 schools still have pending reports', 'October reporting closes on October 31. Review the schools with outstanding monthly submissions.', FALSE, TIMESTAMPTZ '2026-10-26 07:30:00+08'),
  ('sysadmin', 'New school record verified', 'The school record for Harborview Senior High School was updated by the district office.', FALSE, TIMESTAMPTZ '2026-10-25 14:10:00+08'),
  ('sysadmin', 'Weekly activity digest ready', 'Five administrative actions were recorded in the audit trail this week.', FALSE, TIMESTAMPTZ '2026-10-25 08:00:00+08'),
  ('northadmin', 'North Valley reporting update', 'Two North Valley schools have pending October submissions.', FALSE, TIMESTAMPTZ '2026-10-26 08:15:00+08'),
  ('northadmin', 'Announcement published', 'The October monitoring window announcement is now visible to authorized staff.', FALSE, TIMESTAMPTZ '2026-10-24 09:00:00+08'),
  ('northadmin', 'Profile reminder', 'Confirm your contact email in Account Settings to receive reports.', TRUE, TIMESTAMPTZ '2026-10-20 09:00:00+08'),
  ('northstaff', 'Reporting deadline approaching', 'Please coordinate with your school head for outstanding October reports.', FALSE, TIMESTAMPTZ '2026-10-26 08:20:00+08'),
  ('riversideadmin', 'Riverside reporting update', 'Greenfield Elementary submitted a late report that needs review.', FALSE, TIMESTAMPTZ '2026-10-25 17:00:00+08'),
  ('southstaff', 'School record updated', 'Oakridge Elementary School remains inactive. Contact the district office if its status changes.', TRUE, TIMESTAMPTZ '2026-10-23 11:00:00+08'),
  ('northadmin', 'PSDS account awaiting confirmation', 'Alicia Navarro has a pending PSDS registration for North Valley School District.', FALSE, TIMESTAMPTZ '2026-10-26 09:10:00+08'),
  ('northpsds', 'School head account awaiting confirmation', 'A school head registration is waiting for PSDS confirmation at Central Elementary School.', FALSE, TIMESTAMPTZ '2026-10-26 09:20:00+08'),
  ('northhead', 'Teacher account awaiting confirmation', 'A teacher registration is waiting for school head confirmation at Central Elementary School.', FALSE, TIMESTAMPTZ '2026-10-26 09:30:00+08'),
  ('northadviser', 'Learner account awaiting confirmation', 'A learner registration is waiting for adviser confirmation at Central Elementary School.', FALSE, TIMESTAMPTZ '2026-10-26 09:40:00+08')
) AS v(username, title, message, is_read, created_at)
JOIN users u ON u.username = v.username
WHERE NOT EXISTS (
  SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.title = v.title
);

INSERT INTO audit_logs (user_id, action, entity_type, entity_id, district_id, details, ip_address, created_at)
SELECT u.id, v.action, v.entity_type, v.entity_id,
       COALESCE(u.district_id, d.id),
       v.details::jsonb, '127.0.0.1'::inet, v.created_at
FROM (VALUES
  ('sysadmin', 'user.login', 'user', '1', NULL, '{"username":"sysadmin"}', TIMESTAMPTZ '2026-10-26 07:20:00+08'),
  ('sysadmin', 'school.updated', 'school', '8', 'NVD', '{"school_code":"RHS-101","fields":["school_head","contact_phone"]}', TIMESTAMPTZ '2026-10-25 14:10:00+08'),
  ('sysadmin', 'report.submitted', 'school_report', '1', 'NVD', '{"school_code":"NES-001","period":"2026-10"}', TIMESTAMPTZ '2026-10-24 10:05:00+08'),
  ('sysadmin', 'announcement.published', 'announcement', '1', NULL, '{"title":"October monitoring window is now open"}', TIMESTAMPTZ '2026-10-24 09:00:00+08'),
  ('sysadmin', 'school.created', 'school', '16', 'SGD', '{"school_code":"STH-201"}', TIMESTAMPTZ '2026-10-21 11:30:00+08'),
  ('northadmin', 'user.login', 'user', '2', NULL, '{"username":"northadmin"}', TIMESTAMPTZ '2026-10-26 08:10:00+08')
) AS v(username, action, entity_type, entity_id, district_code, details, created_at)
JOIN users u ON u.username = v.username
LEFT JOIN districts d ON d.district_code = v.district_code
WHERE NOT EXISTS (SELECT 1 FROM audit_logs);

-- ---------------------------------------------------------------------------
-- Learner records demo data (fictional learners at Central Elementary School)
-- ---------------------------------------------------------------------------

INSERT INTO school_years (name, starts_on, ends_on, is_current)
VALUES
  ('2025-2026', DATE '2025-06-02', DATE '2026-03-31', FALSE),
  ('2026-2027', DATE '2026-06-01', DATE '2027-03-31', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO grade_levels (school_id, name, sort_order)
SELECT s.id, v.name, v.sort_order
FROM schools s
CROSS JOIN (VALUES ('Grade 5', 5), ('Grade 6', 6)) AS v(name, sort_order)
WHERE s.school_code = 'NES-001'
ON CONFLICT (school_id, name) DO NOTHING;

INSERT INTO sections (school_id, school_year_id, grade_level_id, name, adviser_id, room)
SELECT s.id, y.id, g.id, v.name,
       (SELECT id FROM users WHERE username = 'northadviser'),
       v.room
FROM (VALUES
  ('2025-2026', 'Grade 5', 'Mabini', 'Room 105'),
  ('2026-2027', 'Grade 6', 'Rizal', 'Room 204')
) AS v(school_year, grade_level, name, room)
JOIN schools s ON s.school_code = 'NES-001'
JOIN school_years y ON y.name = v.school_year
JOIN grade_levels g ON g.school_id = s.id AND g.name = v.grade_level
ON CONFLICT (school_id, school_year_id, grade_level_id, name) DO NOTHING;

INSERT INTO learners (
  lrn, last_name, first_name, middle_name, extension_name, birth_date, sex,
  weight_kg, height_cm, house_number, barangay, municipality, province, region, zip_code,
  contact_number, email, school_id, district_id, user_id
)
SELECT v.lrn, v.last_name, v.first_name, v.middle_name, v.extension_name,
       v.birth_date, v.sex, v.weight_kg, v.height_cm,
       v.house_number, v.barangay, v.municipality, v.province, v.region, v.zip_code,
       v.contact_number, v.email, s.id, s.district_id,
       (SELECT id FROM users WHERE username = v.username)
FROM (VALUES
  ('136001230001', 'Lim', 'Joshua', 'Ang', NULL, DATE '2014-05-18', 'male', 38.50, 142.00, '24 Rizal Street', 'Poblacion', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', '+63 917 555 0101', 'joshua.lim@example.com', 'northlearner'),
  ('136001230002', 'Reyes', 'Maria Sofia', 'Bautista', NULL, DATE '2014-08-02', 'female', 36.00, 140.50, '8 Mabini Street', 'Poblacion', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', '+63 917 555 0102', 'sofia.reyes@example.com', NULL),
  ('136001230003', 'Cruz', 'Nathaniel', 'Santos', NULL, DATE '2014-01-27', 'male', 41.00, 145.00, '15 Bonifacio Avenue', 'San Roque', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', '+63 917 555 0103', 'nathaniel.cruz@example.com', NULL),
  ('136001230004', 'Gonzales', 'Althea', 'Mendoza', NULL, DATE '2014-11-09', 'female', 34.50, 138.00, '3 Luna Street', 'Poblacion', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', NULL, NULL, NULL),
  ('136001230005', 'Mendoza', 'Gabriel', 'Torres', NULL, DATE '2013-12-15', 'male', 44.00, 150.00, '61 Del Pilar Street', 'Malinis', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', '+63 917 555 0105', 'gabriel.mendoza@example.com', NULL),
  ('136001230006', 'Ramos', 'Isabella', 'Cruz', NULL, DATE '2014-04-03', 'female', 35.20, 139.00, '12 Sampaguita Lane', 'San Roque', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', '+63 917 555 0106', NULL, NULL),
  ('136001230007', 'Santos', 'Elijah', 'Garcia', NULL, DATE '2014-07-21', 'male', 39.80, 143.00, '45 Acacia Street', 'Malinis', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', NULL, NULL, NULL),
  ('136001230008', 'Villanueva', 'Chloe', 'Domingo', NULL, DATE '2014-02-14', 'female', 33.00, 137.50, '7 Narra Street', 'Poblacion', 'San Isidro', 'Nueva Ecija', 'Region III (Central Luzon)', '3100', '+63 917 555 0108', 'chloe.villanueva@example.com', NULL)
) AS v(lrn, last_name, first_name, middle_name, extension_name, birth_date, sex, weight_kg, height_cm,
       house_number, barangay, municipality, province, region, zip_code, contact_number, email, username)
JOIN schools s ON s.school_code = 'NES-001'
ON CONFLICT (lrn) DO NOTHING;

INSERT INTO guardians (learner_id, full_name, relationship, contact_number, email, address, occupation, is_primary, is_emergency)
SELECT l.id, v.full_name, v.relationship, v.contact_number, v.email, v.address, v.occupation,
       v.is_primary, v.is_emergency
FROM (VALUES
  ('136001230001', 'Ramon D. Lim', 'Father', '+63 917 555 0201', 'ramon.lim@example.com', '24 Rizal Street, Poblacion, San Isidro, Nueva Ecija', 'School Teacher', TRUE, TRUE),
  ('136001230001', 'Cristina A. Lim', 'Mother', '+63 917 555 0202', 'cristina.lim@example.com', '24 Rizal Street, Poblacion, San Isidro, Nueva Ecija', 'Nurse', FALSE, FALSE),
  ('136001230002', 'Eduardo S. Reyes', 'Father', '+63 917 555 0203', 'eduardo.reyes@example.com', '8 Mabini Street, Poblacion, San Isidro, Nueva Ecija', 'Driver', TRUE, TRUE),
  ('136001230003', 'Lourdes P. Cruz', 'Mother', '+63 917 555 0204', 'lourdes.cruz@example.com', '15 Bonifacio Avenue, San Roque, San Isidro, Nueva Ecija', 'Vendor', TRUE, TRUE),
  ('136001230004', 'Rogelio M. Gonzales', 'Father', '+63 917 555 0205', NULL, '3 Luna Street, Poblacion, San Isidro, Nueva Ecija', 'Farmer', TRUE, FALSE),
  ('136001230005', 'Teresita T. Mendoza', 'Mother', '+63 917 555 0206', 'teresita.mendoza@example.com', '61 Del Pilar Street, Malinis, San Isidro, Nueva Ecija', 'Barangay Health Worker', TRUE, TRUE),
  ('136001230006', 'Antonio C. Ramos', 'Father', '+63 917 555 0207', NULL, '12 Sampaguita Lane, San Roque, San Isidro, Nueva Ecija', 'Carpenter', TRUE, FALSE),
  ('136001230007', 'Jocelyn G. Santos', 'Mother', '+63 917 555 0208', 'jocelyn.santos@example.com', '45 Acacia Street, Malinis, San Isidro, Nueva Ecija', 'Store Owner', TRUE, TRUE),
  ('136001230008', 'Ferdinand D. Villanueva', 'Father', '+63 917 555 0209', 'ferdinand.villanueva@example.com', '7 Narra Street, Poblacion, San Isidro, Nueva Ecija', 'Electrician', TRUE, FALSE)
) AS v(lrn, full_name, relationship, contact_number, email, address, occupation, is_primary, is_emergency)
JOIN learners l ON l.lrn = v.lrn
WHERE NOT EXISTS (
  SELECT 1 FROM guardians g WHERE g.learner_id = l.id AND g.full_name = v.full_name
);

INSERT INTO enrollments (learner_id, school_id, school_year_id, grade_level_id, section_id, adviser_id, enrollment_date, status, remarks)
SELECT l.id, sec.school_id, sec.school_year_id, sec.grade_level_id, sec.id, sec.adviser_id,
       COALESCE(y.starts_on, DATE '2026-06-01'), 'enrolled', NULL
FROM learners l
JOIN schools s ON s.id = l.school_id AND s.school_code = 'NES-001'
JOIN school_years y ON y.name IN ('2025-2026', '2026-2027')
JOIN sections sec ON sec.school_id = s.id AND sec.school_year_id = y.id
JOIN grade_levels g ON g.id = sec.grade_level_id
WHERE sec.name = CASE y.name WHEN '2025-2026' THEN 'Mabini' ELSE 'Rizal' END
ON CONFLICT (learner_id, school_year_id) DO NOTHING;

INSERT INTO subjects (school_id, code, name, grade_level_id)
SELECT s.id, v.code, v.name,
       (SELECT g.id FROM grade_levels g WHERE g.school_id = s.id AND g.name = v.grade_level)
FROM schools s
CROSS JOIN (VALUES
  ('ENG6', 'English 6', 'Grade 6'),
  ('FIL6', 'Filipino 6', 'Grade 6'),
  ('MATH6', 'Mathematics 6', 'Grade 6'),
  ('SCI6', 'Science 6', 'Grade 6'),
  ('AP6', 'Araling Panlipunan 6', 'Grade 6'),
  ('MAPEH6', 'MAPEH 6', 'Grade 6'),
  ('ESP6', 'Edukasyon sa Pagpapakatao 6', 'Grade 6'),
  ('TLE6', 'Technology and Livelihood Education 6', 'Grade 6')
) AS v(code, name, grade_level)
WHERE s.school_code = 'NES-001'
ON CONFLICT (school_id, code) DO NOTHING;

INSERT INTO teacher_assignments (school_id, school_year_id, section_id, subject_id, teacher_id, employee_number)
SELECT sec.school_id, sec.school_year_id, sec.id, sub.id,
       (SELECT id FROM users WHERE username = v.teacher_username),
       v.employee_number
FROM sections sec
JOIN schools s ON s.id = sec.school_id AND s.school_code = 'NES-001'
JOIN school_years y ON y.id = sec.school_year_id AND y.name = '2026-2027'
JOIN subjects sub ON sub.school_id = sec.school_id
CROSS JOIN (VALUES
  ('ENG6', 'northteacher', 'EMP-1001'),
  ('MATH6', 'northteacher', 'EMP-1001'),
  ('SCI6', 'northadviser', 'EMP-1002'),
  ('FIL6', 'northadviser', 'EMP-1002'),
  ('MAPEH6', 'northteacher', 'EMP-1001')
) AS v(subject_code, teacher_username, employee_number)
WHERE sec.name = 'Rizal' AND sub.code = v.subject_code
ON CONFLICT (section_id, subject_id, teacher_id) DO NOTHING;

INSERT INTO class_schedules (assignment_id, day_of_week, start_time, end_time, room)
SELECT a.id, v.day_of_week, v.start_time::time, v.end_time::time, v.room
FROM teacher_assignments a
JOIN sections sec ON sec.id = a.section_id
JOIN subjects sub ON sub.id = a.subject_id
JOIN school_years y ON y.id = a.school_year_id AND y.name = '2026-2027'
CROSS JOIN (VALUES
  ('ENG6', 1, '07:30', '08:20', 'Room 204'),
  ('MATH6', 1, '08:20', '09:10', 'Room 204'),
  ('SCI6', 1, '09:30', '10:20', 'Room 204'),
  ('FIL6', 1, '10:20', '11:10', 'Room 204'),
  ('MAPEH6', 1, '13:00', '13:50', 'Quadrangle'),
  ('ENG6', 2, '07:30', '08:20', 'Room 204'),
  ('MATH6', 2, '08:20', '09:10', 'Room 204'),
  ('SCI6', 2, '09:30', '10:20', 'Room 204'),
  ('FIL6', 2, '10:20', '11:10', 'Room 204'),
  ('MAPEH6', 3, '07:30', '08:20', 'Quadrangle'),
  ('ENG6', 3, '08:20', '09:10', 'Room 204'),
  ('MATH6', 3, '09:30', '10:20', 'Room 204'),
  ('SCI6', 4, '07:30', '08:20', 'Room 204'),
  ('FIL6', 4, '08:20', '09:10', 'Room 204'),
  ('MAPEH6', 5, '07:30', '08:20', 'Quadrangle')
) AS v(subject_code, day_of_week, start_time, end_time, room)
WHERE sec.name = 'Rizal' AND sub.code = v.subject_code
  AND NOT EXISTS (
    SELECT 1 FROM class_schedules c
    WHERE c.assignment_id = a.id AND c.day_of_week = v.day_of_week AND c.start_time = v.start_time::time
  );

INSERT INTO activities (school_id, school_year_id, name, category, organization, adviser_id, participation_level, start_date, end_date, achievement, remarks, created_by)
SELECT s.id, y.id, v.name, v.category, v.organization,
       (SELECT id FROM users WHERE username = 'northadviser'),
       v.participation_level, v.start_date, v.end_date, v.achievement, v.remarks,
       (SELECT id FROM users WHERE username = 'sysadmin')
FROM schools s
JOIN school_years y ON y.name = '2026-2027'
CROSS JOIN (VALUES
  ('Division Science and Technology Fair', 'Academic Competition', 'Science Club', 'division', DATE '2026-09-18', DATE '2026-09-18', 'Second Place - Robotics Exhibition', 'Division-level science fair held at the division office.'),
  ('Campus Journalism Workshop', 'Campus Journalism', 'The Central Pen', 'school', DATE '2026-08-05', DATE '2026-08-07', 'Certificate of Participation', 'Three-day workshop for student writers.'),
  ('District Basketball Tournament', 'Sports and Athletics', 'Central Elementary Basketball Team', 'district', DATE '2026-10-12', DATE '2026-10-16', 'Champion', 'District meet held at the municipal sports complex.')
) AS v(name, category, organization, participation_level, start_date, end_date, achievement, remarks)
WHERE s.school_code = 'NES-001'
  AND NOT EXISTS (
    SELECT 1 FROM activities a WHERE a.school_id = s.id AND a.school_year_id = y.id AND a.name = v.name
  );

INSERT INTO learner_activities (activity_id, learner_id, role, achievement, remarks)
SELECT a.id, l.id, v.role, v.achievement, v.remarks
FROM activities a
JOIN schools s ON s.id = a.school_id AND s.school_code = 'NES-001'
JOIN learners l ON l.school_id = s.id
CROSS JOIN (VALUES
  ('Division Science and Technology Fair', '136001230001', 'Team Captain', 'Second Place', 'Led the robotics team.'),
  ('Division Science and Technology Fair', '136001230003', 'Member', 'Second Place', NULL),
  ('Campus Journalism Workshop', '136001230002', 'Editorial Writer', 'Certificate of Participation', NULL),
  ('District Basketball Tournament', '136001230005', 'Point Guard', 'Champion', 'Named to the mythical five.')
) AS v(activity_name, lrn, role, achievement, remarks)
WHERE a.name = v.activity_name AND l.lrn = v.lrn
ON CONFLICT (activity_id, learner_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Demonstration class record configuration. These weights are fictional sample
-- values for the seeded school only. They are not presented as an official
-- DepEd grading configuration; a real school must verify and replace them.
-- ---------------------------------------------------------------------------
UPDATE class_record_templates
SET config = '{"components":[{"key":"ww","label":"Written Work","weight":0.30},{"key":"pt","label":"Performance Tasks","weight":0.50},{"key":"qa","label":"Quarterly Assessment","weight":0.20}],"rounding":"nearest_whole","transmutation":{"mode":"none"},"note":"Demonstration weights for the fictional seed data only. Not an official DepEd configuration."}'::jsonb,
    source_note = 'Demonstration configuration for fictional seed data. Replace the weights with the school''s verified policy before real use.'
WHERE version = 'system-1' AND is_official = FALSE;

UPDATE sections
SET curriculum_version_id = (
  SELECT cv.id FROM curriculum_versions cv
  JOIN curricula c ON c.id = cv.curriculum_id
  WHERE c.code = 'SYS' AND cv.version_code = 'system-1'
)
WHERE curriculum_version_id IS NULL;

COMMIT;
