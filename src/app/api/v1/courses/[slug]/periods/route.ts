import { managePeriod, managePeriodSchema, requireCourseAccess, selectEnrollmentPeriod, selectPeriodSchema } from "@/lib/server/courses";
import { apiData, parseJson, requireSameOrigin, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string }> };

export const POST = withApi<Context>(async (request, context, ctx) => {
  requireSameOrigin(request);
  const access = await requireCourseAccess(request, (await context.params).slug, { moderate: true });
  const input = await parseJson(request, managePeriodSchema);
  return apiData(await managePeriod(access, input, ctx.requestId), ctx.requestId);
});

export const PATCH = withApi<Context>(async (request, context, ctx) => {
  requireSameOrigin(request);
  const access = await requireCourseAccess(request, (await context.params).slug);
  const input = await parseJson(request, selectPeriodSchema);
  return apiData(await selectEnrollmentPeriod(access, input.periodId), ctx.requestId);
});
