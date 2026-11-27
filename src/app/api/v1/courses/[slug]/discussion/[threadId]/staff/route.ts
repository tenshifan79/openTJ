import { requireCourseAccess } from "@/lib/server/auth";
import { staffThreadInput, updateDiscussionStaff } from "@/lib/server/discussion";
import { apiData, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string; threadId: string }> };

export const PATCH = withApi<Context>(async (request, context, { requestId }) => {
  const { slug, threadId } = await context.params;
  const access = await requireCourseAccess(request, slug, { moderate: true });
  const input = await parseJson(request, staffThreadInput);
  return apiData(await updateDiscussionStaff(access, threadId, input, requestId), requestId);
});
