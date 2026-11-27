import { requireCourseAccess } from "@/lib/server/auth";
import { createReply, replyInput } from "@/lib/server/discussion";
import { apiData, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string; threadId: string }> };

export const POST = withApi<Context>(async (request, context, { requestId }) => {
  const { slug, threadId } = await context.params;
  const access = await requireCourseAccess(request, slug);
  return apiData(await createReply(access, threadId, await parseJson(request, replyInput)), requestId, { status: 201 });
});
