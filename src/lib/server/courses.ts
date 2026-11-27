import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isPlatformAdmin, requireCourseAccess, requireUser, type CourseAccess } from "./auth";
import { contentInclude, publicParentsWhere, serializeContent, serializeManyContent, visibleWhere } from "./content";
import { questionFlags } from "./question-flags";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { AppError } from "./http";
import { isPdfUploadEnabled } from "./env";

export async function listCourses(request: Request) {
  const user = await requireUser(request);
  const isAdmin = await isPlatformAdmin(user.id);
  const courses = await db.course.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, take: 200,
    include: { memberships: { where: { userId: user.id }, include: { period: true } }, _count: { select: { memberships: true } } } });
  return { isAdmin, courses: courses.map((c) => ({ id: c.id, slug: c.slug, name: c.name, description: c.description, joined: isAdmin || Boolean(c.memberships.length), role: c.memberships[0]?.role ?? (isAdmin ? "STAFF" : null), periodLabel: c.memberships[0]?.period?.label, memberCount: c._count.memberships })) };
}

export async function courseSnapshot(access: CourseAccess, compact = false) {
  const allKinds = ["ASSESSMENT", "CALENDAR_EVENT", "NOTE", "ADVICE", "QUESTION"] as const;
  const kinds = compact ? allKinds.filter(kind => kind !== "NOTE" && kind !== "ADVICE") : allKinds;
  const groups = await Promise.all(kinds.map((kind) => db.contentItem.findMany({ where: { ...visibleWhere(access), kind }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 101, include: contentInclude })));
  const items = groups.flatMap((group) => group.slice(0, 100));
  const flags = await questionFlags(items.flatMap((item) => item.question?.revisions.map((r) => r.id) ?? []));
  const records = items.filter((item) => {
    // Parent visibility is authoritative without overwriting independent child moderation state.
    if (item.calendarEvent?.assessment && item.calendarEvent.assessment.contentItem.visibility !== "PUBLISHED") return access.canModerate || item.authorId === access.user.id;
    if (item.question && !item.question.bank.active) return access.canModerate || item.authorId === access.user.id;
    return true;
  }).map((item) => {
    const value = serializeContent(item, access);
    if (item.question) Object.assign(value, { graded: flags.get(item.question.revisions[0]?.id ?? "") ?? false, parentHidden: !item.question.bank.active });
    if (item.calendarEvent?.assessment) Object.assign(value, { parentHidden: item.calendarEvent.assessment.contentItem.visibility !== "PUBLISHED" });
    return { kind: item.kind, value };
  });
  const [banks, memberCount, notices, periods, recent] = await Promise.all([
    db.questionBank.findMany({ where: { courseId: access.course.id, active: true, assessment: { contentItem: { visibility: "PUBLISHED" } } }, orderBy: { title: "asc" }, take: 200, select: { id: true, title: true, assessmentId: true } }),
    db.courseMembership.count({ where: { courseId: access.course.id } }),
    db.moderationAction.findMany({ where: { courseId: access.course.id, contentItem: { authorId: access.user.id }, type: { in: ["HIDE", "LOCK", "RESTORE", "UNLOCK"] } }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, contentItemId: true, type: true, reason: true, createdAt: true, reportId: true, appeals: { select: { status: true, resolution: true } } } }),
    db.coursePeriod.findMany({ where: { courseId: access.course.id }, orderBy: { label: "asc" }, select: { id: true, label: true } }),
    compact ? db.contentItem.findMany({
      where: { courseId: access.course.id, visibility: "PUBLISHED", kind: { in: ["ASSESSMENT", "NOTE", "ADVICE"] } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 8,
      select: { id: true, updatedAt: true, author: { select: { displayName: true } }, assessment: { select: { title: true } }, note: { select: { title: true } }, advice: { select: { title: true } } },
    }) : Promise.resolve([]),
  ]);
  const base = `/courses/${access.course.slug}`;
  return { course: { ...access.course, memberCount }, user: access.user, periods, periodId: access.membership?.periodId ?? null,
    permissions: { canModerate: access.canModerate, isAdmin: access.isAdmin, pdfUploadsEnabled: isPdfUploadEnabled() },
    assessments: records.filter((r) => r.kind === "ASSESSMENT").map((r) => r.value), events: records.filter((r) => r.kind === "CALENDAR_EVENT").map((r) => r.value),
    notes: records.filter((r) => r.kind === "NOTE").map((r) => r.value), advice: records.filter((r) => r.kind === "ADVICE").map((r) => r.value), questions: records.filter((r) => r.kind === "QUESTION").map((r) => r.value), banks, notices,
    ...(compact ? { recent: recent.map(item => ({
      id: item.id, author: item.author.displayName, updatedAt: item.updatedAt,
      title: item.assessment?.title ?? item.note?.title ?? item.advice?.title ?? "Contribution",
      href: item.note ? `${base}/materials#${item.id}` : item.advice ? `${base}/discussion/${item.id}` : `${base}/assessments#${item.id}`,
    })) } : {}),
    nextCursors: Object.fromEntries(kinds.map((kind, index) => [kind, (groups[index]?.length ?? 0) > 100 ? groups[index]?.[99]?.id ?? null : null])) };
}

export async function searchCourse(access: CourseAccess, query: string) {
  const text = z.string().trim().min(2).max(120).parse(query);
  const contains = { contains: text, mode: "insensitive" as const };
  const records = await db.contentItem.findMany({ where: { courseId: access.course.id, visibility: "PUBLISHED", ...publicParentsWhere(), OR: [
    { assessment: { OR: [{ title: contains }, { summary: contains }, { description: contains }] } },
    { note: { OR: [{ title: contains }, { body: contains }] } }, { advice: { OR: [{ title: contains }, { body: contains }] } }, { discussionReply: { body: contains } },
    { question: { bank: { active: true, assessment: { contentItem: { visibility: "PUBLISHED" } } }, revisions: { some: { prompt: contains } } } },
  ] }, orderBy: { updatedAt: "desc" }, take: 50, include: contentInclude });
  // Search latest prompts only; older revisions must not expose removed text through a match.
  const matching = records.filter((item) => !item.question || item.question.revisions[0]?.prompt.toLowerCase().includes(text.toLowerCase()));
  const values = await serializeManyContent(matching, access);
  const base = `/courses/${access.course.slug}`;
  return { results: values.map((value, index) => {
    const item = matching[index]!;
    const href = item.discussionReply ? `${base}/discussion/${item.discussionReply.threadId}#${item.id}`
      : item.advice ? `${base}/discussion/${item.id}`
      : item.note ? `${base}/materials#${item.id}`
      : item.question ? `${base}/questions?assessment=${item.question.bank.assessmentId}#${item.id}`
      : `${base}/assessments#${item.id}`;
    return { ...value, contentKind: item.kind, href };
  }) };
}

const periodLabel = z.string().trim().min(1).max(40);
const periodId = z.string().min(1).max(100);
const joinCode = z.string().trim().min(1).max(100);
export const joinPreviewSchema = z.object({ code: joinCode });
export const joinCourseSchema = joinPreviewSchema.extend({ periodId: periodId.optional(), preview: z.boolean().optional() });

export const courseDetailsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(5000).default(""),
});

export const createCourseSchema = courseDetailsSchema.extend({
  periods: z.array(periodLabel).min(1).max(20),
}).refine(({ periods }) => new Set(periods.map((label) => label.toLowerCase())).size === periods.length, {
  path: ["periods"],
  message: "Use a different name for each period.",
});

export async function updateCourseDetails(access: CourseAccess, input: z.infer<typeof courseDetailsSchema>, requestId: string) {
  if (!access.canModerate) throw new AppError(403, "COURSE_STAFF_REQUIRED", "Only course staff can edit class details.");
  return db.$transaction(async tx => {
    const course = await tx.course.update({ where: { id: access.course.id, archivedAt: null }, data: input, select: { id: true, slug: true, name: true, description: true } });
    await tx.auditEvent.create({ data: { actorId: access.user.id, courseId: course.id, action: "EDIT_COURSE_DETAILS", targetType: "Course", targetId: course.id, requestId } });
    return course;
  });
}

function courseSlug(name: string) {
  return name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).replace(/-$/, "") || "course";
}

export async function createCourse(request: Request, input: z.infer<typeof createCourseSchema>, requestId: string) {
  const user = await requireUser(request);
  const isAdmin = await isPlatformAdmin(user.id);
  if (!user.isTeacher && !isAdmin) throw new AppError(403, "TEACHER_REQUIRED", "Course creation requires school staff access.");
  const stem = courseSlug(input.name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = attempt === 0 ? stem : `${stem}-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    try {
      return await db.$transaction(async (tx) => {
        const course = await tx.course.create({
          data: {
            slug,
            name: input.name,
            description: input.description,
            periods: { create: input.periods.map((label) => ({ label })) },
            memberships: { create: { userId: user.id, role: "STAFF" } },
          },
          select: { id: true, slug: true },
        });
        await tx.auditEvent.create({
          data: { actorId: user.id, courseId: course.id, action: "CREATE_COURSE", targetType: "Course", targetId: course.id, requestId },
        });
        return course;
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  throw new AppError(409, "COURSE_NAME_TAKEN", "Choose a different course name.");
}

async function getJoinInvitation(tx: Prisma.TransactionClient, code: string) {
  const found = await tx.courseJoinCode.findUnique({ where: { codeHash: sha256(code.trim()) }, include: { course: true } });
  if (!found || found.revokedAt || (found.expiresAt && found.expiresAt <= new Date()) || found.course.archivedAt) throw new AppError(400, "INVALID_JOIN_CODE", "This course code is invalid or expired.");
  return found;
}

async function lockCourse(tx: Prisma.TransactionClient, courseId: string) {
  await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
}

export async function previewJoinCourse(request: Request, code: string) {
  const user = await requireUser(request);
  const invitation = await getJoinInvitation(db, code);
  const [membership, periods] = await Promise.all([
    db.courseMembership.findUnique({ where: { courseId_userId: { courseId: invitation.courseId, userId: user.id } } }),
    user.isStudent ? db.coursePeriod.findMany({ where: { courseId: invitation.courseId }, orderBy: { label: "asc" }, select: { id: true, label: true } }) : [],
  ]);
  return {
    slug: invitation.course.slug,
    name: invitation.course.name,
    joined: Boolean(membership),
    needsPeriod: !membership?.periodId && membership?.role !== "STAFF" && periods.length > 1,
    periods,
  };
}

export async function joinCourse(request: Request, input: z.infer<typeof joinCourseSchema>) {
  const user = await requireUser(request);
  return db.$transaction(async (tx) => {
    const invitation = await getJoinInvitation(tx, input.code);
    await lockCourse(tx, invitation.courseId);
    const { course, courseId } = await getJoinInvitation(tx, input.code);
    const key = { courseId_userId: { courseId, userId: user.id } };
    const membership = await tx.courseMembership.findUnique({ where: key });
    if (membership?.role === "STAFF" || membership?.periodId) return { slug: course.slug, joined: true };
    const periods = user.isStudent ? await tx.coursePeriod.findMany({ where: { courseId }, take: 2, select: { id: true } }) : [];
    if (periods.length > 1 && !input.periodId) throw new AppError(400, "PERIOD_REQUIRED", "Choose your period.");
    if (input.periodId && (!periods.length || !await tx.coursePeriod.findUnique({ where: { id_courseId: { id: input.periodId, courseId } } }))) {
      throw new AppError(400, "INVALID_PERIOD", "Choose a period for this course.");
    }
    const period = input.periodId ?? periods[0]?.id ?? null;
    await tx.courseMembership.upsert({ where: key, create: { courseId, userId: user.id, periodId: period }, update: { periodId: period } });
    return { slug: course.slug, joined: true };
  });
}
export async function rotateJoinCode(access: CourseAccess, requestId: string) {
  if (!access.canModerate) throw new AppError(403, "COURSE_STAFF_REQUIRED", "Only course staff can rotate the join code.");
  const code = randomToken(12);
  await db.$transaction(async (tx) => {
    await lockCourse(tx, access.course.id);
    await tx.courseJoinCode.updateMany({ where: { courseId: access.course.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.courseJoinCode.create({ data: { courseId: access.course.id, codeHash: sha256(code), createdById: access.user.id, expiresAt: new Date(Date.now() + 30 * 86_400_000) } });
    await tx.auditEvent.create({ data: { actorId: access.user.id, courseId: access.course.id, action: "ROTATE_JOIN_CODE", targetType: "Course", targetId: access.course.id, requestId } });
  });
  return { code, expiresInDays: 30 };
}

export const memberSchema = z.object({ username: z.string().trim().min(1).max(100), role: z.enum(["MEMBER", "STAFF"]).default("MEMBER"), remove: z.boolean().default(false), periodId: periodId.nullable().optional() });
export async function manageMember(access: CourseAccess, input: z.infer<typeof memberSchema>, requestId: string) {
  if (!access.canModerate) throw new AppError(403, "COURSE_STAFF_REQUIRED", "Only course staff can manage members.");
  const user = await db.user.findUnique({ where: { username: input.username } });
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "This user must sign in to openTJ first.");
  if (input.role === "STAFF" && !input.remove && !user.isTeacher) throw new AppError(400, "TEACHER_REQUIRED", "Course staff must be verified teachers.");
  await db.$transaction(async (tx) => {
    const courseId = access.course.id;
    const key = { courseId_userId: { courseId, userId: user.id } };
    await lockCourse(tx, courseId);
    const membership = await tx.courseMembership.findUnique({ where: key });
    if (!access.isAdmin && (input.role === "STAFF" || membership?.role === "STAFF")) throw new AppError(403, "ADMIN_REQUIRED", "Only administrators may change staff assignments.");
    const period = input.role === "STAFF" ? null : input.periodId;
    if (period && !input.remove && !await tx.coursePeriod.findUnique({ where: { id_courseId: { id: period, courseId } } })) {
      throw new AppError(400, "INVALID_PERIOD", "Choose a period for this course.");
    }
    if (input.remove) await tx.courseMembership.deleteMany({ where: { courseId, userId: user.id } });
    else await tx.courseMembership.upsert({ where: key, create: { courseId, userId: user.id, role: input.role, periodId: period }, update: { role: input.role, ...(period !== undefined ? { periodId: period } : {}) } });
    await tx.auditEvent.create({ data: { actorId: access.user.id, courseId, action: input.remove ? "REMOVE_MEMBER" : "SET_MEMBERSHIP", targetType: "User", targetId: user.id, requestId, metadata: { role: input.role, ...(period !== undefined ? { periodId: period } : {}) } } });
  });
  return { updated: true };
}

export const managePeriodSchema = z.object({ id: periodId.optional(), label: periodLabel });
export const selectPeriodSchema = z.object({ periodId });

export async function selectEnrollmentPeriod(access: CourseAccess, selected: string) {
  if (!access.user.isStudent || access.membership?.role !== "MEMBER" || access.canModerate) {
    throw new AppError(403, "STUDENT_REQUIRED", "Student membership is required.");
  }
  const courseId = access.course.id;
  return db.$transaction(async (tx) => {
    await lockCourse(tx, courseId);
    const period = await tx.coursePeriod.findUnique({ where: { id_courseId: { id: selected, courseId } }, select: { id: true } });
    if (!period) throw new AppError(400, "INVALID_PERIOD", "Choose a period for this course.");
    const changed = await tx.courseMembership.updateMany({
      where: { courseId, userId: access.user.id, role: "MEMBER", periodId: null },
      data: { periodId: period.id },
    });
    if (!changed.count) {
      const membership = await tx.courseMembership.findUnique({ where: { courseId_userId: { courseId, userId: access.user.id } } });
      if (membership?.periodId !== period.id) throw new AppError(409, "PERIOD_ALREADY_ASSIGNED", "Ask your teacher to change your period.");
    }
    return { periodId: period.id };
  });
}

export async function managePeriod(access: CourseAccess, input: z.infer<typeof managePeriodSchema>, requestId: string) {
  if (!access.canModerate) throw new AppError(403, "COURSE_STAFF_REQUIRED", "Only course staff can manage periods.");
  const courseId = access.course.id;
  return db.$transaction(async (tx) => {
    await lockCourse(tx, courseId);
    const periods = await tx.coursePeriod.findMany({ where: { courseId }, select: { id: true, label: true } });
    if (input.id && !periods.some((period) => period.id === input.id)) throw new AppError(404, "PERIOD_NOT_FOUND", "Period not found.");
    if (!input.id && periods.length >= 20) throw new AppError(409, "PERIOD_LIMIT", "A course can have up to 20 periods.");
    if (periods.some((period) => period.id !== input.id && period.label.toLowerCase() === input.label.toLowerCase())) {
      throw new AppError(409, "PERIOD_NAME_TAKEN", "Use a different name for this period.");
    }
    const period = input.id
      ? await tx.coursePeriod.update({ where: { id_courseId: { id: input.id, courseId } }, data: { label: input.label } })
      : await tx.coursePeriod.create({ data: { courseId, label: input.label } });
    await tx.auditEvent.create({ data: {
      actorId: access.user.id, courseId, action: input.id ? "RENAME_PERIOD" : "CREATE_PERIOD", targetType: "CoursePeriod", targetId: period.id, requestId,
    } });
    return { id: period.id, label: period.label };
  });
}

export async function adminSnapshot(request: Request) {
  const actor = await requireUser(request);
  const isAdmin = await isPlatformAdmin(actor.id);
  const scope: Prisma.CourseWhereInput = isAdmin ? {} : { memberships: { some: { userId: actor.id, role: "STAFF" } }, archivedAt: null };
  const courses = await db.course.findMany({ where: scope, orderBy: { name: "asc" }, take: 200 });
  if (!isAdmin && !courses.length) throw new AppError(403, "COURSE_STAFF_REQUIRED", "Staff access is required.");
  const users = await db.user.findMany({ where: isAdmin ? {} : { memberships: { some: { courseId: { in: courses.map((c) => c.id) } } } }, take: 500, orderBy: { displayName: "asc" },
    select: { id: true, username: true, displayName: true, isTeacher: true, accountStatus: true, roleGrants: { select: { role: true } }, memberships: { where: { courseId: { in: courses.map((c) => c.id) } }, select: { courseId: true, role: true } } } });
  return { isAdmin, courses, users: users.map(({ roleGrants, ...user }) => ({ ...user, isAdmin: roleGrants.some((g) => g.role === "PLATFORM_ADMIN") })) };
}
export const adminSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createCourse"), name: z.string().trim().min(1).max(200), slug: z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), description: z.string().trim().max(5000).default("") }),
  z.object({ action: z.literal("course"), courseId: z.string().min(1), archived: z.boolean() }),
  z.object({ action: z.literal("user"), userId: z.string().min(1), accountStatus: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]).optional(), isAdmin: z.boolean().optional() }),
]);
export async function administer(actorId: string, input: z.infer<typeof adminSchema>, requestId: string) {
  return db.$transaction(async (tx) => {
    // Serialize role changes so concurrent administrators cannot revoke each
    // other's last active administrator access between authorization and commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('opentj:administrator-roles'))`;
    const actor = await tx.roleGrant.findFirst({ where: { userId: actorId, role: "PLATFORM_ADMIN", user: { accountStatus: "ACTIVE" } } });
    if (!actor) throw new AppError(403, "ADMIN_REQUIRED", "Administrator access was revoked. Reload before continuing.");
    let targetId: string;
    if (input.action === "createCourse") {
      const course = await tx.course.create({ data: { name: input.name, slug: input.slug, description: input.description } });
      targetId = course.id;
    } else if (input.action === "course") {
      await tx.course.update({ where: { id: input.courseId }, data: { archivedAt: input.archived ? new Date() : null } });
      targetId = input.courseId;
    } else {
      if (input.userId === actorId && (input.isAdmin === false || (input.accountStatus && input.accountStatus !== "ACTIVE"))) throw new AppError(400, "SELF_RESTRICTION", "An administrator cannot revoke or suspend their own access.");
      const user = await tx.user.findUnique({ where: { id: input.userId } });
      if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found.");
      if (input.isAdmin === false || (input.accountStatus && input.accountStatus !== "ACTIVE")) {
        const grants = await tx.roleGrant.findMany({ where: { role: "PLATFORM_ADMIN", user: { accountStatus: "ACTIVE" } }, select: { userId: true } });
        if (grants.length === 1 && grants[0]?.userId === user.id) throw new AppError(409, "LAST_ADMINISTRATOR", "Grant another active administrator before revoking this access.");
      }
      if (input.accountStatus) {
        await tx.user.update({ where: { id: user.id }, data: { accountStatus: input.accountStatus } });
        if (input.accountStatus !== "ACTIVE") await tx.session.deleteMany({ where: { userId: user.id } });
      }
      if (input.isAdmin === true) await tx.roleGrant.upsert({ where: { userId_role: { userId: user.id, role: "PLATFORM_ADMIN" } }, create: { userId: user.id, role: "PLATFORM_ADMIN", grantedById: actorId }, update: {} });
      if (input.isAdmin === false) await tx.roleGrant.deleteMany({ where: { userId: user.id, role: "PLATFORM_ADMIN" } });
      targetId = user.id;
    }
    await tx.auditEvent.create({ data: { actorId, action: `ADMIN_${input.action.toUpperCase()}`, targetType: input.action === "user" ? "User" : "Course", targetId, requestId, metadata: input } });
    return { updated: true, id: targetId };
  });
}
export { requireCourseAccess };
