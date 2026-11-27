import { courseDetailsSchema, courseSnapshot, requireCourseAccess, updateCourseDetails } from "@/lib/server/courses";
import { apiData, parseJson, withApi } from "@/lib/server/http";
type Context = { params: Promise<{ slug: string }> };
export const GET = withApi<Context>(async (request, context, { requestId }) => {
  const { slug } = await context.params;
  const access = await requireCourseAccess(request, slug);
  return apiData(await courseSnapshot(access, request.nextUrl.searchParams.get("view") === "compact"), requestId);
});
export const PATCH = withApi<Context>(async (request, context, { requestId }) => {
  const { slug } = await context.params;
  const access = await requireCourseAccess(request, slug, { moderate: true });
  return apiData(await updateCourseDetails(access, await parseJson(request, courseDetailsSchema), requestId), requestId);
});
