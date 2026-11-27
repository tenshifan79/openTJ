import { requireCourseAccess } from "@/lib/server/auth";
import { reactionInput, setReaction } from "@/lib/server/discussion";
import { apiData, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string; threadId: string }> };

export const PUT = withApi<Context>(async (request, context, { requestId }) => {
  const { slug, threadId } = await context.params;
  const access = await requireCourseAccess(request, slug);
  return apiData(await setReaction(access, threadId, await parseJson(request, reactionInput)), requestId);
});
