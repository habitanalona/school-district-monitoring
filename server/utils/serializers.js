"use strict";

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function serializeUser(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    fullName: row.full_name,
    username: row.username,
    email: row.email,
    role: row.role,
    districtId: numberOrNull(row.district_id),
    districtName: row.district_name || null,
    districtCode: row.district_code || null,
    schoolId: numberOrNull(row.school_id),
    schoolName: row.school_name || null,
    schoolCode: row.school_code || null,
    isActive: row.is_active,
    approvalStatus: row.approval_status || "active",
    approvedBy: numberOrNull(row.approved_by),
    approvedAt: row.approved_at || null,
    rejectionNote: row.rejection_note || null,
    lastLoginAt: row.last_login_at || null,
    passwordChangedAt: row.password_changed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSchool(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    code: row.school_code,
    name: row.school_name,
    type: row.school_type,
    address: row.address,
    districtId: Number(row.district_id),
    districtName: row.district_name || null,
    districtCode: row.district_code || null,
    head: row.school_head,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    studentCount: Number(row.student_count),
    teacherCount: Number(row.teacher_count),
    performanceScore: numberOrNull(row.performance_score),
    status: row.status,
    reportStatus: row.report_status || null,
    reportPeriod: row.report_period || null,
    submittedAt: row.report_submitted_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function serializeReport(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    schoolName: row.school_name || null,
    schoolCode: row.school_code || null,
    districtId: numberOrNull(row.district_id),
    districtName: row.district_name || null,
    reportingPeriod: row.reporting_period,
    reportType: row.report_type,
    submissionStatus: row.submission_status,
    submittedById: numberOrNull(row.submitted_by),
    submittedByName: row.submitted_by_name || null,
    submittedAt: row.submitted_at,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeAnnouncement(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    createdById: numberOrNull(row.created_by),
    createdByName: row.created_by_name || null,
    districtId: numberOrNull(row.district_id),
    districtName: row.district_name || null,
    publishedAt: row.published_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeAudit(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    userId: numberOrNull(row.user_id),
    userName: row.user_name || "System",
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    districtId: numberOrNull(row.district_id),
    districtName: row.district_name || null,
    details: row.details || {},
    ipAddress: row.ip_address,
    createdAt: row.created_at
  };
}

function serializeNotification(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    title: row.title,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at
  };
}

function countOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function serializeDistrict(row) {
  if (!row) {
    return null;
  }
  const psds = [
    {
      name: row.psds_one_name || null,
      email: row.psds_one_email || null,
      phone: row.psds_one_phone || null
    },
    {
      name: row.psds_two_name || null,
      email: row.psds_two_email || null,
      phone: row.psds_two_phone || null
    }
  ].filter((supervisor) => supervisor.name);
  return {
    id: Number(row.id),
    name: row.district_name,
    code: row.district_code,
    address: row.address || null,
    contactEmail: row.contact_email || null,
    psds,
    schoolCount: countOrNull(row.school_count),
    userCount: countOrNull(row.user_count),
    announcementCount: countOrNull(row.announcement_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = {
  serializeUser,
  serializeSchool,
  serializeReport,
  serializeAnnouncement,
  serializeAudit,
  serializeNotification,
  serializeDistrict
};
