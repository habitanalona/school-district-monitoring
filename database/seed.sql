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

COMMIT;
