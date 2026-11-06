"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  WORKSPACE,
  workspaceFor,
  workspaceAtLeast,
  resolveScope,
  schoolScopeFor,
  isNonTeachingReadOnly,
  assertDistrictAccess,
  assertSchoolAccess
} = require("../server/utils/scope");

const accounts = {
  system: { id: 1, role: "system_admin", districtId: 1, schoolId: null },
  districtAdmin: { id: 2, role: "district_admin", districtId: 2, schoolId: null },
  psds: { id: 3, role: "psds", districtId: 2, schoolId: null },
  head: { id: 4, role: "school_head", districtId: 2, schoolId: 9 },
  coordinator: { id: 5, role: "coordinator", districtId: 2, schoolId: 9 },
  adviser: { id: 6, role: "adviser", districtId: 2, schoolId: 9 },
  teacher: { id: 7, role: "teacher", districtId: 2, schoolId: 9 },
  nt: { id: 8, role: "nt", districtId: 2, schoolId: 9 },
  ntCoordinator: { id: 9, roles: ["nt", "coordinator"], districtId: 2, schoolId: 9 },
  learner: { id: 10, role: "learner", districtId: 2, schoolId: 9 }
};

test("workspace is derived from the union of account roles", () => {
  assert.equal(workspaceFor(accounts.system), WORKSPACE.ALL);
  assert.equal(workspaceFor(accounts.districtAdmin), WORKSPACE.DISTRICT);
  assert.equal(workspaceFor(accounts.psds), WORKSPACE.DISTRICT);
  assert.equal(workspaceFor(accounts.head), WORKSPACE.SCHOOL);
  assert.equal(workspaceFor(accounts.coordinator), WORKSPACE.SCHOOL);
  assert.equal(workspaceFor(accounts.nt), WORKSPACE.SCHOOL);
  assert.equal(workspaceFor(accounts.adviser), WORKSPACE.CLASS);
  assert.equal(workspaceFor(accounts.teacher), WORKSPACE.CLASS);
  assert.equal(workspaceFor(accounts.learner), WORKSPACE.LEARNER);
});

test("workspaceAtLeast respects the all > district > school > class order", () => {
  assert.equal(workspaceAtLeast(accounts.system, "district"), true);
  assert.equal(workspaceAtLeast(accounts.psds, "district"), true);
  assert.equal(workspaceAtLeast(accounts.psds, "school"), true);
  assert.equal(workspaceAtLeast(accounts.head, "district"), false);
  assert.equal(workspaceAtLeast(accounts.head, "school"), true);
  assert.equal(workspaceAtLeast(accounts.teacher, "school"), false);
  assert.equal(workspaceAtLeast(accounts.teacher, "class"), true);
});

test("only pure non-teaching accounts are forced into read-only mode", () => {
  assert.equal(isNonTeachingReadOnly(accounts.nt), true);
  assert.equal(isNonTeachingReadOnly(accounts.ntCoordinator), false);
  assert.equal(isNonTeachingReadOnly(accounts.teacher), false);
  assert.equal(isNonTeachingReadOnly(accounts.head), false);
});

test("district and school scopes are pinned for narrower workspaces", () => {
  assert.equal(resolveScope(accounts.psds, "99"), 2);
  assert.equal(resolveScope(accounts.head, "99"), 2);
  assert.equal(resolveScope(accounts.system, "99"), 99);
  assert.equal(resolveScope(accounts.system, ""), null);
  assert.equal(resolveScope(accounts.psds, undefined), 2);

  assert.equal(schoolScopeFor(accounts.head, "99"), 9);
  assert.equal(schoolScopeFor(accounts.teacher, "99"), 9);
  assert.equal(schoolScopeFor(accounts.districtAdmin, "99"), 99);
  assert.equal(schoolScopeFor(accounts.districtAdmin, "all"), null);
  assert.equal(schoolScopeFor(accounts.system, ""), null);
});

test("cross-district and cross-school access is rejected", () => {
  assert.doesNotThrow(() => assertDistrictAccess(accounts.system, 7));
  assert.doesNotThrow(() => assertDistrictAccess(accounts.psds, 2));
  assert.throws(() => assertDistrictAccess(accounts.psds, 7), { status: 403 });

  assert.doesNotThrow(() => assertSchoolAccess(accounts.psds, 9, 2));
  assert.throws(() => assertSchoolAccess(accounts.psds, 9, 7), { status: 403 });
  assert.doesNotThrow(() => assertSchoolAccess(accounts.head, 9, 2));
  assert.throws(() => assertSchoolAccess(accounts.head, 10, 2), { status: 403 });
  assert.throws(() => assertSchoolAccess(accounts.teacher, 10, 2), { status: 403 });
});
