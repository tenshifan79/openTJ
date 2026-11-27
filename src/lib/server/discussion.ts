import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { DiscussionReactionSummary } from "@/lib/discussion";
import { requirePolicyAccepted, type CourseAccess } from "./auth";
import { assertPublishedReference, claimVersion, contentMetadata, recordRevision } from "./content";
import { db } from "./db";
import { AppError, parsePagination } from "./http";

const id = z.string().min(1).max(200);
const body = z.string().trim().min(1).max(30_000);
const version = z.number().int().positive();
export const threadInput = z.object({
  title: z.string().trim().min(1).max(200),
  body,
  type: z.enum(["QUESTION", "ADVICE"]),
  assessmentId: id.nullable().optional(),
});
export const threadEditInput = threadInput.extend({ version });
export const replyInput = z.object({ body, replyToId: id.nullable().optional() });
export const replyEditInput = z.object({ body, version });
export const reactionInput = z.object({
  contentId: id,
  kind: z.enum(["WONDERING", "MAKES_SENSE", "AGREE", "DISAGREE"]).nullable(),
});
export const staffThreadInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("PIN"), pinned: z.boolean() }),
  z.object({ action: z.literal("ENDORSE"), replyId: id.nullable() }),
]);

export const discussionQuery = (url: URL) => ({
  ...parsePagination(url, 50),
  unanswered: url.searchParams.get("unanswered") === "1",
  target: id.optional().parse(url.searchParams.get("target") || undefined),
});

const author = { select: { displayName: true, username: true } } as const;
const threadSelect = Prisma.validator<Prisma.AdvicePostSelect>()({
  contentItemId: true,
  title: true,
  type: true,
  pinnedAt: true,
  contentItem: { include: { author } },
  assessment: { select: { contentItemId: true, title: true, contentItem: { select: { visibility: true } } } },
  _count: { select: { replies: { where: { contentItem: { visibility: "PUBLISHED" } } } } },
});
const replyInclude = Prisma.validator<Prisma.DiscussionReplyInclude>()({
  contentItem: { include: { author } },
  replyTo: { select: { contentItem: { select: { id: true, visibility: true, author } } } },
});
type Thread = Prisma.AdvicePostGetPayload<{ select: typeof threadSelect }>;
type Reply = Prisma.DiscussionReplyGetPayload<{ include: typeof replyInclude }>;

function threadMetadata(row: Thread) {
  const visible = row.contentItem.visibility === "PUBLISHED";
  return {
    ...contentMetadata(row.contentItem),
    title: row.title,
    type: row.type === "QUESTION" ? "QUESTION" as const : "ADVICE" as const,
    assessment: row.assessment?.contentItem.visibility === "PUBLISHED"
      ? { id: row.assessment.contentItemId, title: row.assessment.title } : null,
    pinned: visible && row.pinnedAt !== null,
    replyCount: visible ? row._count.replies : 0,
  };
}

function emptyReactionSummary(): DiscussionReactionSummary {
  return { counts: { WONDERING: 0, MAKES_SENSE: 0, AGREE: 0, DISAGREE: 0 }, selected: null };
}

async function reactionSummaries(client: Prisma.TransactionClient, ids: string[], viewerId: string) {
  const summaries = new Map(ids.map((itemId) => [itemId, emptyReactionSummary()]));
  if (!ids.length) return summaries;
  const where = { contentItemId: { in: ids } };
  const [counts, selected] = await Promise.all([
    client.discussionReaction.groupBy({ by: ["contentItemId", "kind"], where, _count: { _all: true } }),
    client.discussionReaction.findMany({ where: { ...where, userId: viewerId }, select: { contentItemId: true, kind: true } }),
  ]);
  for (const row of counts) summaries.get(row.contentItemId)!.counts[row.kind] = row._count._all;
  for (const row of selected) summaries.get(row.contentItemId)!.selected = row.kind;
  return summaries;
}

export async function listThreads(access: CourseAccess, query: ReturnType<typeof discussionQuery>) {
  const rows = await db.advicePost.findMany({
    where: {
      courseId: access.course.id,
      contentItem: { visibility: access.canModerate && !query.unanswered ? { not: "DELETED" } : "PUBLISHED" },
      ...(query.unanswered ? { type: "QUESTION", replies: { none: { contentItem: { visibility: "PUBLISHED" } } } } : {}),
    },
    select: threadSelect,
    orderBy: [{ pinnedAt: { sort: "desc", nulls: "last" } }, { contentItem: { createdAt: "desc" } }, { contentItemId: "desc" }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { contentItemId: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return { threads: page.map(threadMetadata), nextCursor: rows.length > query.limit ? page.at(-1)!.contentItemId : null };
}

export async function readThread(access: CourseAccess, threadId: string, query: ReturnType<typeof discussionQuery>) {
  const thread = await db.advicePost.findFirst({
    where: { contentItemId: threadId, courseId: access.course.id, contentItem: {
      visibility: { not: "DELETED" },
      ...(access.canModerate ? {} : { OR: [{ visibility: "PUBLISHED" }, { authorId: access.user.id }] }),
    } },
    select: { ...threadSelect, body: true },
  });
  if (!thread) throw new AppError(404, "THREAD_NOT_FOUND", "Thread not found.");
  const published = thread.contentItem.visibility === "PUBLISHED";
  const where: Prisma.DiscussionReplyWhereInput = {
    threadId, courseId: access.course.id,
    thread: { contentItem: { visibility: access.canModerate ? { not: "DELETED" } : "PUBLISHED" } },
    contentItem: {
      visibility: { not: "DELETED" },
      ...(access.canModerate ? {} : { OR: [{ visibility: "PUBLISHED" }, { authorId: access.user.id }] }),
    },
  };
  const [rows, linked] = await Promise.all([
    db.discussionReply.findMany({
      where,
      include: replyInclude,
      orderBy: [{ contentItem: { createdAt: "asc" } }, { contentItemId: "asc" }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { contentItemId: query.cursor }, skip: 1 } : {}),
    }),
    query.target ? db.discussionReply.findFirst({ where: { ...where, contentItemId: query.target }, include: replyInclude }) : null,
  ]);
  const page = rows.slice(0, query.limit);
  const reactionIds = published
    ? [threadId, ...[...page, ...(linked ? [linked] : [])].filter((r) => r.contentItem.visibility === "PUBLISHED").map((r) => r.contentItemId)]
    : [];
  const reactions = await reactionSummaries(db, reactionIds, access.user.id);
  const serializeReply = (reply: Reply) => {
    const replyTo = reply.replyTo?.contentItem;
    return {
      ...contentMetadata(reply.contentItem),
      body: reply.body,
      replyTo: replyTo?.visibility === "PUBLISHED" ? { id: replyTo.id, author: replyTo.author.displayName } : null,
      replyTargetUnavailable: Boolean(replyTo && replyTo.visibility !== "PUBLISHED"),
      endorsed: published && reply.contentItem.visibility === "PUBLISHED" && reply.endorsedAt !== null,
      reactions: reactions.get(reply.contentItemId) ?? emptyReactionSummary(),
    };
  };
  return {
    thread: { ...threadMetadata(thread), body: thread.body, reactions: reactions.get(threadId) ?? emptyReactionSummary() },
    replies: page.map(serializeReply),
    linkedReply: linked ? serializeReply(linked) : null,
    nextCursor: rows.length > query.limit ? page.at(-1)!.contentItemId : null,
  };
}

function threadFields(input: z.infer<typeof threadInput>) {
  return { title: input.title, body: input.body, assessmentId: input.assessmentId ?? null,
    type: input.type === "QUESTION" ? "QUESTION" as const : input.assessmentId ? "ASSESSMENT_SPECIFIC" as const : "GENERAL" as const };
}

export async function createThread(access: CourseAccess, input: z.infer<typeof threadInput>) {
  await requirePolicyAccepted(access.user.id);
  return db.$transaction(async (tx) => {
    const courseId = access.course.id;
    if (input.assessmentId) await assertPublishedReference(tx, courseId, input.assessmentId, "ASSESSMENT");
    const item = await tx.contentItem.create({ data: { courseId, authorId: access.user.id, kind: "ADVICE", publishedAt: new Date() } });
    const fields = threadFields(input);
    await tx.advicePost.create({ data: { contentItemId: item.id, courseId, ...fields } });
    await recordRevision(tx, item.id, 1, access.user.id, fields);
    return { id: item.id };
  });
}

async function lockThread(tx: Prisma.TransactionClient, access: CourseAccess, threadId: string) {
  const courseId = access.course.id;
  await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${threadId} AND "courseId" = ${courseId} AND "kind" = 'ADVICE' FOR UPDATE`;
  const thread = await tx.advicePost.findFirst({
    where: { contentItemId: threadId, courseId, contentItem: { visibility: "PUBLISHED" } },
    include: { contentItem: true },
  });
  if (!thread) throw new AppError(404, "THREAD_NOT_FOUND", "Thread not found.");
  return thread;
}

function assertEditable(access: CourseAccess, item: { authorId: string; locked: boolean }) {
  if (access.canModerate) return;
  if (item.authorId !== access.user.id) throw new AppError(403, "CONTENT_OWNER_REQUIRED", "Only the author or course staff can edit this post.");
  if (item.locked) throw new AppError(423, "CONTENT_LOCKED", "This post is locked.");
}

export async function editThread(access: CourseAccess, threadId: string, input: z.infer<typeof threadEditInput>) {
  await requirePolicyAccepted(access.user.id);
  return db.$transaction(async (tx) => {
    const thread = await lockThread(tx, access, threadId);
    assertEditable(access, thread.contentItem);
    if (input.assessmentId && input.assessmentId !== thread.assessmentId) {
      await assertPublishedReference(tx, access.course.id, input.assessmentId, "ASSESSMENT");
    }
    await claimVersion(tx, threadId, input.version);
    const fields = threadFields({ ...input, assessmentId: input.assessmentId === undefined ? thread.assessmentId : input.assessmentId });
    await tx.advicePost.update({ where: { contentItemId: threadId }, data: fields });
    await recordRevision(tx, threadId, input.version + 1, access.user.id, fields);
    return { id: threadId };
  });
}

async function lockPublishedReply(tx: Prisma.TransactionClient, threadId: string, replyId: string) {
  await tx.$queryRaw`
    SELECT item.id FROM "ContentItem" item JOIN "DiscussionReply" reply ON reply."contentItemId" = item.id
    WHERE item.id = ${replyId} AND reply."threadId" = ${threadId} FOR UPDATE OF item
  `;
  const reply = await tx.discussionReply.findFirst({
    where: { contentItemId: replyId, threadId, contentItem: { visibility: "PUBLISHED" } },
    include: { contentItem: true },
  });
  if (!reply) throw new AppError(404, "REPLY_NOT_FOUND", "Reply not found.");
  return reply;
}

export async function createReply(access: CourseAccess, threadId: string, input: z.infer<typeof replyInput>) {
  await requirePolicyAccepted(access.user.id);
  return db.$transaction(async (tx) => {
    const thread = await lockThread(tx, access, threadId);
    if (thread.contentItem.locked) throw new AppError(423, "THREAD_LOCKED", "This discussion is locked.");
    if (input.replyToId) await lockPublishedReply(tx, threadId, input.replyToId);
    const courseId = access.course.id;
    const item = await tx.contentItem.create({ data: { courseId, authorId: access.user.id, kind: "DISCUSSION_REPLY", publishedAt: new Date() } });
    const fields = { threadId, body: input.body, replyToId: input.replyToId ?? null };
    await tx.discussionReply.create({ data: { contentItemId: item.id, courseId, ...fields } });
    await recordRevision(tx, item.id, 1, access.user.id, fields);
    return { id: item.id };
  });
}

export async function editReply(access: CourseAccess, threadId: string, replyId: string, input: z.infer<typeof replyEditInput>) {
  await requirePolicyAccepted(access.user.id);
  return db.$transaction(async (tx) => {
    const thread = await lockThread(tx, access, threadId);
    if (thread.contentItem.locked && !access.canModerate) throw new AppError(423, "THREAD_LOCKED", "This discussion is locked.");
    const reply = await lockPublishedReply(tx, threadId, replyId);
    assertEditable(access, reply.contentItem);
    await claimVersion(tx, replyId, input.version);
    await tx.discussionReply.update({
      where: { contentItemId: replyId },
      data: { body: input.body, ...(input.body !== reply.body ? { endorsedAt: null, endorsedById: null } : {}) },
    });
    await recordRevision(tx, replyId, input.version + 1, access.user.id, { threadId, body: input.body, replyToId: reply.replyToId });
    return { id: replyId };
  });
}

export async function setReaction(access: CourseAccess, threadId: string, input: z.infer<typeof reactionInput>) {
  return db.$transaction(async (tx) => {
    await lockThread(tx, access, threadId);
    if (input.contentId !== threadId) await lockPublishedReply(tx, threadId, input.contentId);
    const key = { contentItemId: input.contentId, userId: access.user.id };
    if (input.kind) {
      await tx.discussionReaction.upsert({
        where: { contentItemId_userId: key }, create: { ...key, kind: input.kind }, update: { kind: input.kind },
      });
    } else {
      await tx.discussionReaction.deleteMany({ where: key });
    }
    return (await reactionSummaries(tx, [input.contentId], access.user.id)).get(input.contentId)!;
  });
}

export async function updateDiscussionStaff(access: CourseAccess, threadId: string, input: z.infer<typeof staffThreadInput>, requestId: string) {
  if (!access.canModerate) throw new AppError(403, "COURSE_STAFF_REQUIRED", "Course staff access is required.");
  return db.$transaction(async (tx) => {
    const thread = await lockThread(tx, access, threadId);
    if (input.action === "PIN") {
      if (input.pinned === (thread.pinnedAt !== null)) return { id: threadId };
      await tx.advicePost.update({ where: { contentItemId: threadId }, data: { pinnedAt: input.pinned ? new Date() : null } });
    } else {
      const existing = await tx.discussionReply.findFirst({ where: { threadId, endorsedAt: { not: null } }, select: { contentItemId: true } });
      if (input.replyId) await lockPublishedReply(tx, threadId, input.replyId);
      if (input.replyId === (existing?.contentItemId ?? null)) return { id: threadId };
      if (existing) await tx.discussionReply.update({ where: { contentItemId: existing.contentItemId }, data: { endorsedAt: null, endorsedById: null } });
      if (input.replyId) await tx.discussionReply.update({
        where: { contentItemId: input.replyId }, data: { endorsedAt: new Date(), endorsedById: access.user.id },
      });
    }
    await tx.auditEvent.create({
      data: { actorId: access.user.id, courseId: access.course.id, requestId, action: input.action === "PIN" ? "DISCUSSION_PIN" : "DISCUSSION_ENDORSE",
        targetType: "ContentItem", targetId: threadId, metadata: input },
    });
    return { id: threadId };
  });
}
