"use strict";

const MANILA_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function toIsoDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

// "Today" is resolved in Philippine time so a learner does not gain a year a
// few hours early while the server clock is still on UTC.
function todayInManila(reference) {
  if (reference instanceof Date) {
    return reference.toISOString().slice(0, 10);
  }
  return MANILA_DATE.format(new Date());
}

// Age is always derived from the birth date. It is never accepted from a form
// and never stored, so it can never drift out of sync with the profile.
function calculateAge(birthDate, reference = null) {
  const birth = toIsoDate(birthDate);
  const today = todayInManila(reference);
  if (!birth || !today) {
    return null;
  }

  const [birthYear, birthMonth, birthDay] = birth.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);

  let age = todayYear - birthYear;
  const hasHadBirthday =
    todayMonth > birthMonth || (todayMonth === birthMonth && todayDay >= birthDay);
  if (!hasHadBirthday) {
    age -= 1;
  }
  return age >= 0 && age <= 130 ? age : null;
}

// School years run June to March in Philippine public schools; this only
// suggests a label and never overwrites an existing folder.
function suggestedSchoolYear(reference = null) {
  const today = todayInManila(reference);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

module.exports = { calculateAge, suggestedSchoolYear, toIsoDate, todayInManila };
