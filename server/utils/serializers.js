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
    photoUpdatedAt: row.photo_updated_at || null,
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

const { calculateAge } = require("./age");

const DAY_NAMES = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday"
};

function isoDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function timeText(value) {
  if (!value) {
    return null;
  }
  return String(value).slice(0, 5);
}

function decimalOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function personName(row) {
  if (!row) {
    return "";
  }
  const parts = [row.first_name, row.middle_name, row.last_name, row.extension_name].filter(Boolean);
  return parts.join(" ");
}

function formalName(row) {
  if (!row) {
    return "";
  }
  const given = [row.first_name, row.middle_name].filter(Boolean).join(" ");
  const surname = [row.last_name, row.extension_name].filter(Boolean).join(" ");
  return given ? `${surname}, ${given}` : surname;
}

function missingProfileFields(row) {
  const missing = [];
  if (!row.barangay) missing.push("Barangay");
  if (!row.municipality) missing.push("Municipality / city");
  if (!row.province) missing.push("Province");
  if (!row.region) missing.push("Region");
  if (!row.zip_code) missing.push("ZIP code");
  if (!row.contact_number && !row.email) missing.push("Contact number");
  if (row.has_guardian === false) missing.push("Parent or guardian");
  return missing;
}

function serializeLearner(row) {
  if (!row) {
    return null;
  }
  const missingFields = missingProfileFields(row);
  return {
    id: Number(row.id),
    lrn: row.lrn,
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: row.middle_name || null,
    extensionName: row.extension_name || null,
    fullName: personName(row),
    formalName: formalName(row),
    birthDate: isoDate(row.birth_date),
    age: calculateAge(row.birth_date),
    sex: row.sex,
    weightKg: decimalOrNull(row.weight_kg),
    heightCm: decimalOrNull(row.height_cm),
    houseNumber: row.house_number || null,
    barangay: row.barangay || null,
    municipality: row.municipality || null,
    province: row.province || null,
    region: row.region || null,
    zipCode: row.zip_code || null,
    addressLine: [row.house_number, row.barangay, row.municipality, row.province, row.region, row.zip_code]
      .filter(Boolean)
      .join(", "),
    contactNumber: row.contact_number || null,
    email: row.email || null,
    schoolId: numberOrNull(row.school_id),
    schoolName: row.school_name || null,
    schoolCode: row.school_code || null,
    districtId: numberOrNull(row.district_id),
    districtName: row.district_name || null,
    userId: numberOrNull(row.user_id),
    archivedAt: row.archived_at || null,
    isArchived: Boolean(row.archived_at),
    profileComplete: missingFields.length === 0,
    missingFields,
    currentEnrollment: row.enrollment_id
      ? {
          id: Number(row.enrollment_id),
          schoolYearId: numberOrNull(row.enrollment_year_id),
          schoolYearName: row.enrollment_year_name || null,
          gradeLevelId: numberOrNull(row.enrollment_grade_level_id),
          gradeLevel: row.enrollment_grade_level || null,
          sectionId: numberOrNull(row.enrollment_section_id),
          sectionName: row.enrollment_section_name || null,
          adviserId: numberOrNull(row.enrollment_adviser_id),
          adviserName: row.enrollment_adviser_name || null,
          status: row.enrollment_status || null
        }
      : null,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeGuardian(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    learnerId: Number(row.learner_id),
    fullName: row.full_name,
    relationship: row.relationship,
    contactNumber: row.contact_number || null,
    email: row.email || null,
    address: row.address || null,
    occupation: row.occupation || null,
    isPrimary: Boolean(row.is_primary),
    isEmergency: Boolean(row.is_emergency),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeEnrollment(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    learnerId: Number(row.learner_id),
    schoolId: Number(row.school_id),
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    isCurrentYear: row.is_current === undefined ? null : Boolean(row.is_current),
    gradeLevelId: Number(row.grade_level_id),
    gradeLevel: row.grade_level_name || null,
    sectionId: numberOrNull(row.section_id),
    sectionName: row.section_name || null,
    adviserId: numberOrNull(row.adviser_id),
    adviserName: row.adviser_name || null,
    enrollmentDate: isoDate(row.enrollment_date),
    status: row.status,
    remarks: row.remarks || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSchoolYear(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    name: row.name,
    startsOn: isoDate(row.starts_on),
    endsOn: isoDate(row.ends_on),
    isCurrent: Boolean(row.is_current),
    sectionCount: countOrNull(row.section_count),
    learnerCount: countOrNull(row.learner_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeGradeLevel(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    schoolName: row.school_name || null,
    name: row.name,
    sortOrder: Number(row.sort_order || 0),
    sectionCount: countOrNull(row.section_count),
    learnerCount: countOrNull(row.learner_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSection(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    schoolName: row.school_name || null,
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    gradeLevelId: Number(row.grade_level_id),
    gradeLevel: row.grade_level_name || null,
    name: row.name,
    adviserId: numberOrNull(row.adviser_id),
    adviserName: row.adviser_name || null,
    room: row.room || null,
    learnerCount: countOrNull(row.learner_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeSubject(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    code: row.code,
    name: row.name,
    gradeLevelId: numberOrNull(row.grade_level_id),
    gradeLevel: row.grade_level_name || null,
    assignmentCount: countOrNull(row.assignment_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeTeacherAssignment(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    sectionId: Number(row.section_id),
    sectionName: row.section_name || null,
    gradeLevel: row.grade_level_name || null,
    subjectId: Number(row.subject_id),
    subjectCode: row.subject_code || null,
    subjectName: row.subject_name || null,
    teacherId: numberOrNull(row.teacher_id),
    teacherName: row.teacher_name || null,
    employeeNumber: row.employee_number || null,
    remarks: row.remarks || null,
    scheduleCount: countOrNull(row.schedule_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeClassSchedule(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    assignmentId: Number(row.assignment_id),
    schoolId: numberOrNull(row.school_id),
    schoolYearId: numberOrNull(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    sectionId: numberOrNull(row.section_id),
    sectionName: row.section_name || null,
    gradeLevel: row.grade_level_name || null,
    subjectId: numberOrNull(row.subject_id),
    subjectCode: row.subject_code || null,
    subjectName: row.subject_name || null,
    teacherId: numberOrNull(row.teacher_id),
    teacherName: row.teacher_name || null,
    dayOfWeek: Number(row.day_of_week),
    dayName: DAY_NAMES[Number(row.day_of_week)] || "",
    startTime: timeText(row.start_time),
    endTime: timeText(row.end_time),
    room: row.room || null,
    remarks: row.remarks || null
  };
}

function serializeActivity(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    schoolName: row.school_name || null,
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    name: row.name,
    category: row.category,
    organization: row.organization || null,
    adviserId: numberOrNull(row.adviser_id),
    adviserName: row.adviser_name || null,
    participationLevel: row.participation_level,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    achievement: row.achievement || null,
    remarks: row.remarks || null,
    participantCount: countOrNull(row.participant_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeLearnerActivity(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    activityId: Number(row.activity_id),
    learnerId: Number(row.learner_id),
    name: row.name || null,
    category: row.category || null,
    organization: row.organization || null,
    schoolYearId: numberOrNull(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    participationLevel: row.participation_level || null,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    achievement: row.achievement || row.activity_achievement || null,
    role: row.role || null,
    remarks: row.remarks || null,
    adviserName: row.adviser_name || null,
    createdAt: row.created_at
  };
}

function serializeLearnerDocument(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    learnerId: Number(row.learner_id),
    schoolYearId: numberOrNull(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    title: row.title,
    documentType: row.document_type,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    uploadedBy: numberOrNull(row.uploaded_by),
    uploadedByName: row.uploaded_by_name || null,
    createdAt: row.created_at
  };
}

module.exports = {
  serializeUser,
  serializeSchool,
  serializeReport,
  serializeAnnouncement,
  serializeAudit,
  serializeNotification,
  serializeDistrict,
  serializeLearner,
  serializeGuardian,
  serializeEnrollment,
  serializeSchoolYear,
  serializeGradeLevel,
  serializeSection,
  serializeSubject,
  serializeTeacherAssignment,
  serializeClassSchedule,
  serializeActivity,
  serializeLearnerActivity,
  serializeLearnerDocument
};
