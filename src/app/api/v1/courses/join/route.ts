import { joinCourse, joinCourseSchema, previewJoinCourse } from "@/lib/server/courses";
import { apiData, parseJson, requireSameOrigin, withApi } from "@/lib/server/http";

export const POST = withApi(async (request, _, ctx) => {
  requireSameOrigin(request);
  const input = await parseJson(request, joinCourseSchema);
  const result = input.preview ? await previewJoinCourse(request, input.code) : await joinCourse(request, input);
  return apiData(result, ctx.requestId);
});
