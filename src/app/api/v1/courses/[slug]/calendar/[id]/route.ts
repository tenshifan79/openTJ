import { calendarActionSchema, changeCalendarOccurrence } from "@/lib/server/content";
import { requireCourseAccess } from "@/lib/server/auth";
import { apiData, parseJson, requireSameOrigin, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string; id: string }> };

export const PATCH = withApi<Context>(async (request, context, ctx) => {
  requireSameOrigin(request);
  const { slug, id } = await context.params;
  const access = await requireCourseAccess(request, slug);
  const input = await parseJson(request, calendarActionSchema);
  return apiData(await changeCalendarOccurrence(access, id, input, ctx.requestId), ctx.requestId);
});
