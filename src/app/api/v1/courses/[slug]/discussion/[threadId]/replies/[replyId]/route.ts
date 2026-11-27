import { requireCourseAccess } from "@/lib/server/auth";
import { editReply, replyEditInput } from "@/lib/server/discussion";
import { apiData, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string; threadId: string; replyId: string }> };

export const PATCH = withApi<Context>(async (request, context, { requestId }) => {
  const { slug, threadId, replyId } = await context.params;
  const access = await requireCourseAccess(request, slug);
  return apiData(await editReply(access, threadId, replyId, await parseJson(request, replyEditInput)), requestId);
});
