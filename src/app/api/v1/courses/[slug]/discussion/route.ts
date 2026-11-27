import { requireCourseAccess } from "@/lib/server/auth";
import { createThread, discussionQuery, listThreads, threadInput } from "@/lib/server/discussion";
import { apiData, parseJson, withApi } from "@/lib/server/http";

type Context = { params: Promise<{ slug: string }> };

export const GET = withApi<Context>(async (request, context, { requestId }) => {
  const access = await requireCourseAccess(request, (await context.params).slug);
  return apiData(await listThreads(access, discussionQuery(request.nextUrl)), requestId);
});

export const POST = withApi<Context>(async (request, context, { requestId }) => {
  const access = await requireCourseAccess(request, (await context.params).slug);
  const input = await parseJson(request, threadInput);
  return apiData(await createThread(access, input), requestId, { status: 201 });
});
