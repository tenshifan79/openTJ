import { manageMember, memberSchema, requireCourseAccess } from "@/lib/server/courses";
import { db } from "@/lib/server/db";
import { apiData, parseJson, requireSameOrigin, withApi } from "@/lib/server/http";
type Context = { params: Promise<{ slug: string }> };
export const GET = withApi<Context>(async (request, context, ctx) => {
  const access = await requireCourseAccess(request, (await context.params).slug, { moderate: true });
  const members = await db.courseMembership.findMany({
    where: { courseId: access.course.id },
    orderBy: [{ user: { displayName: "asc" } }, { userId: "asc" }],
    take: 500,
    select: {
      id: true, role: true, periodId: true,
      user: { select: { id: true, displayName: true, username: true, isTeacher: true, accountStatus: true } },
    },
  });
  return apiData({ members }, ctx.requestId);
});
export const POST = withApi<Context>(async (request, context, ctx) => { requireSameOrigin(request); return apiData(await manageMember(await requireCourseAccess(request,(await context.params).slug,{moderate:true}),await parseJson(request,memberSchema),ctx.requestId),ctx.requestId); });
