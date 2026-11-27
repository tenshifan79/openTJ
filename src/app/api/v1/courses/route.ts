import { createCourse, createCourseSchema, listCourses } from "@/lib/server/courses";
import { apiData, parseJson, requireSameOrigin, withApi } from "@/lib/server/http";
export const GET = withApi(async (request, _, ctx) => apiData(await listCourses(request), ctx.requestId));

export const POST = withApi(async (request, _, ctx) => {
  requireSameOrigin(request);
  const input = await parseJson(request, createCourseSchema);
  return apiData(await createCourse(request, input, ctx.requestId), ctx.requestId, { status: 201 });
});
