import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

try { process.loadEnvFile(); } catch { /* CI supplies its own environment. */ }
const base = process.env.OPENTJ_PERIODS_URL ?? process.env.APP_URL ?? "http://127.0.0.1:3000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("Run this verifier against a local development server.");
}

async function client(persona) {
  const signIn = () => fetch(`${base}/api/v1/auth/dev-login`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ persona }),
  });
  let response = await signIn();
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after")) || 60;
    await response.body?.cancel();
    await delay(retryAfter * 1_000);
    response = await signIn();
  }
  assert.equal(response.status, 200, `Login ${persona}: ${await response.text()}`);
  const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  assert.ok(cookie.includes("opentj_session="));
  return async (path, body, method = body === undefined ? "GET" : "POST", status = 200) => {
    const result = await fetch(`${base}/api/v1${path}`, {
      method,
      headers: { cookie, origin: base, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const value = await result.json();
    if (status === 200) assert.ok(result.ok, `${method} ${path}: ${JSON.stringify(value)}`);
    else assert.equal(result.status, status, `${method} ${path}: ${JSON.stringify(value)}`);
    return value.data ?? value;
  };
}

const [teacher, firstStudent, secondStudent, unrelatedTeacher, admin] = await Promise.all([
  client("course-staff"),
  client("student-member"),
  client("student-nonmember"),
  client("unassigned-teacher"),
  client("platform-admin"),
]);
const suffix = randomUUID().slice(0, 8);
const courseInput = { name: `Period verification ${suffix}`, periods: ["Period 4", "Period 6"] };
const courses = [];

try {
  await firstStudent("/courses", courseInput, "POST", 403);
  const course = await teacher("/courses", courseInput, "POST", 201);
  courses.push(course);
  const path = `/courses/${course.slug}`;
  const staffSnapshot = await teacher(path);
  const updatedName = `${courseInput.name} updated`;
  assert.equal((await teacher(path, { name: updatedName }, "PATCH")).slug, course.slug);
  assert.equal((await teacher(path)).course.name, updatedName);
  await unrelatedTeacher(path, { name: "Unauthorized edit" }, "PATCH", 403);
  const [period4, period6] = staffSnapshot.periods;
  assert.equal(staffSnapshot.permissions.canModerate, true);
  assert.deepEqual(staffSnapshot.periods.map(({ label }) => label), courseInput.periods);
  await unrelatedTeacher(`${path}/members`, undefined, "GET", 403);

  const { code } = await teacher(`${path}/join-code`, {});
  await firstStudent("/courses/join", { code: `invalid-${suffix}`, preview: true }, "POST", 400);
  const preview = await firstStudent("/courses/join", { code, preview: true });
  assert.equal(preview.needsPeriod, true);
  assert.equal(preview.periods.length, 2);
  await firstStudent(path, undefined, "GET", 403);
  await firstStudent("/courses/join", { code }, "POST", 400);
  await firstStudent("/courses/join", { code, periodId: "course_concrete_math_av_p4-p4" }, "POST", 400);
  await firstStudent("/courses/join", { code, periodId: period4.id });
  await firstStudent("/courses/join", { code, periodId: period6.id });
  await secondStudent("/courses/join", { code, periodId: period6.id });
  await unrelatedTeacher("/courses/join", { code });
  assert.equal((await unrelatedTeacher(path)).permissions.canModerate, false);
  await unrelatedTeacher("/policy/accept", {});
  await unrelatedTeacher(`${path}/content`, {
    kind: "CALENDAR_EVENT", title: "Fictional shared date", start: "2026-11-29",
  }, "POST", 409);
  assert.equal((await firstStudent(path)).periodId, period4.id);
  assert.equal((await secondStudent(path)).periodId, period6.id);
  await firstStudent(`${path}/periods`, { periodId: period6.id }, "PATCH", 409);
  await firstStudent(`${path}/periods`, { id: period4.id, label: "Test period" }, "POST", 403);
  await teacher(`${path}/members`, { username: "demo.nonmember", periodId: null });
  assert.equal((await secondStudent(path)).periodId, null);
  await secondStudent(`${path}/periods`, { periodId: period6.id }, "PATCH");
  assert.equal((await secondStudent(path)).periodId, period6.id);
  console.log("PASS teacher creation, course-scoped staff access, period enrollment and legacy selection");

  await teacher("/policy/accept", {});
  await firstStudent("/policy/accept", {});
  await secondStudent("/policy/accept", {});
  const assessment = await teacher(`${path}/content`, {
    kind: "ASSESSMENT", assessmentType: "Test", title: "Fictional scheduling assessment", major: true,
  });
  const schedulingUrl = `${path}/assessments/${assessment.id}/calendar`;
  const shared = await teacher(schedulingUrl, { title: assessment.title, start: "2026-11-30", periodId: null });
  assert.ok(shared.confirmedAt);
  await firstStudent(schedulingUrl, { title: assessment.title, start: "2026-12-01", periodId: period6.id }, "POST", 403);
  const [override, repeated] = await Promise.all([
    firstStudent(schedulingUrl, { title: assessment.title, start: "2026-12-01" }),
    firstStudent(schedulingUrl, { title: assessment.title, start: "2026-12-01" }),
  ]);
  assert.equal(repeated.id, override.id);
  assert.equal(override.periodId, period4.id);
  assert.equal(override.confirmedAt, null);
  assert.equal(override.submittedByStudent, true);
  await firstStudent(schedulingUrl, { title: assessment.title, start: "2026-12-02" }, "POST", 409);

  async function verifyDates(forStudent, expectedEvent, expectedDate) {
    const snapshot = await forStudent(path);
    const item = snapshot.assessments.find(({ id }) => id === assessment.id);
    assert.equal(item.calendarEventId, expectedEvent);
    assert.equal(item.date, expectedDate);
    assert.equal(item.occurrences, undefined);
    assert.deepEqual(snapshot.events
      .filter((event) => event.assessmentId === assessment.id && event.visibility === "PUBLISHED")
      .map(({ id }) => id), expectedEvent ? [expectedEvent] : []);
  }

  await verifyDates(firstStudent, override.id, "2026-12-01");
  await verifyDates(secondStudent, shared.id, "2026-11-30");
  await firstStudent(`${path}/content/${shared.id}`, undefined, "GET", 404);
  await secondStudent(`${path}/content/${override.id}`, undefined, "GET", 404);
  await firstStudent(`${path}/calendar/${override.id}`, { action: "confirm", version: override.version }, "PATCH", 403);
  await teacher(`${path}/calendar/${override.id}`, { action: "confirm", version: override.version }, "PATCH");
  const confirmed = await firstStudent(`${path}/content/${override.id}`);
  assert.ok(confirmed.confirmedAt);
  const edited = await firstStudent(`${path}/content/${override.id}`, {
    version: confirmed.version, title: assessment.title,
  }, "PATCH");
  assert.equal(edited.confirmedAt, confirmed.confirmedAt);
  const moved = await firstStudent(`${path}/content/${override.id}`, {
    version: edited.version, start: "2026-12-02",
  }, "PATCH");
  assert.equal(moved.confirmedAt, null);
  const hidden = await firstStudent(`${path}/content/${override.id}/visibility`, {
    version: moved.version, action: "hide",
  });
  await verifyDates(firstStudent, null, "");
  await verifyDates(secondStudent, shared.id, "2026-11-30");
  await teacher(`${path}/calendar/${override.id}`, { action: "remove", version: hidden.version }, "PATCH");
  await verifyDates(firstStudent, shared.id, "2026-11-30");
  const secondOverride = await teacher(schedulingUrl, { title: assessment.title, start: "2026-12-03", periodId: period6.id });
  await verifyDates(firstStudent, shared.id, "2026-11-30");
  await verifyDates(secondStudent, secondOverride.id, "2026-12-03");
  const standalone = await teacher(`${path}/content`, {
    kind: "CALENDAR_EVENT", title: "Fictional period meeting", start: "2026-12-02T08:30:00-05:00", allDay: false, periodId: period4.id,
  });
  assert.equal(standalone.start, "2026-12-02T13:30:00.000Z");
  await firstStudent(`${path}/content/${standalone.id}`);
  await secondStudent(`${path}/content/${standalone.id}`, undefined, "GET", 404);
  await secondStudent(`${path}/content`, { kind: "CALENDAR_UPDATE", calendarEventId: standalone.id, body: "Fictional update." }, "POST", 400);
  console.log("PASS scoped schedules, concurrent linking, confirmation, hidden override and shared fallback");

  const thread = await firstStudent(`${path}/discussion`, {
    type: "QUESTION", title: "Shared question", body: "How do finite differences work?", assessmentId: assessment.id,
  }, "POST", 201);
  const material = await secondStudent(`${path}/content`, {
    kind: "NOTE", title: "Shared practice", mode: "Plain text", tag: "PRACTICE_ASSESSMENT", body: "Practice interpreting a sequence.",
  });
  assert.ok((await secondStudent(`${path}/discussion`)).threads.some(({ id }) => id === thread.id));
  assert.ok((await firstStudent(`${path}/materials?tag=PRACTICE_ASSESSMENT`)).items.some(({ id }) => id === material.id));
  console.log("PASS shared discussion and tagged materials across different period dates");

  const sole = await teacher("/courses", { name: `Single period verification ${suffix}`, periods: ["Period 4"] }, "POST", 201);
  courses.push(sole);
  const solePath = `/courses/${sole.slug}`;
  const soleCode = await teacher(`${solePath}/join-code`, {});
  assert.equal((await firstStudent("/courses/join", { code: soleCode.code, preview: true })).needsPeriod, false);
  await firstStudent("/courses/join", { code: soleCode.code });
  const soleSnapshot = await firstStudent(solePath);
  assert.equal(soleSnapshot.periodId, soleSnapshot.periods[0].id);
  console.log("PASS automatic sole-period enrollment");
} finally {
  for (const course of courses) {
    await admin("/admin", { action: "course", courseId: course.id, archived: true });
  }
}
