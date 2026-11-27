import { requireCourseAccess } from "@/lib/server/auth";
import { discussionQuery, editThread, readThread, threadEditInput } from "@/lib/server/discussion";
import { apiData, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string; threadId: string }> };

export const GET = withApi<Context>(async (request, context, { requestId }) => {
  const { slug, threadId } = await context.params;
  const access = await requireCourseAccess(request, slug);
  return apiData(await readThread(access, threadId, discussionQuery(request.nextUrl)), requestId);
});

export const PATCH = withApi<Context>(async (request, context, { requestId }) => {
  const { slug, threadId } = await context.params;
  const access = await requireCourseAccess(request, slug);
  return apiData(await editThread(access, threadId, await parseJson(request, threadEditInput)), requestId);
});
