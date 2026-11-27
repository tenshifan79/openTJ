import { requireCourseAccess } from "@/lib/server/auth";
import { contentInclude, materialTagSchema, serializeManyContent, visibleWhere } from "@/lib/server/content";
import { db } from "@/lib/server/db";
import { apiData, parsePagination, withApi } from "@/lib/server/http";

export const GET = withApi<RouteContext<"/api/v1/courses/[slug]/materials">>(async (request, context, { requestId }) => {
  const { slug } = await context.params;
  const access = await requireCourseAccess(request, slug);
  const { limit, cursor } = parsePagination(request.nextUrl);
  const tag = materialTagSchema.optional().parse(request.nextUrl.searchParams.get("tag") ?? undefined);
  const where = { ...visibleWhere(access), kind: "NOTE" as const, ...(tag ? { note: { tag } } : {}) };
  const boundary = cursor ? await db.contentItem.findFirst({ where: { ...where, id: cursor }, select: { id: true, createdAt: true } }) : null;
  const page = await db.contentItem.findMany({
    where: boundary ? { AND: [where, { OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] }] } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    include: contentInclude,
  });
  const items = page.slice(0, limit);
  return apiData({ items: await serializeManyContent(items, access), nextCursor: page.length > limit ? items.at(-1)?.id : null }, requestId);
});
