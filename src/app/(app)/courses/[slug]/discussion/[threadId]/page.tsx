import { DiscussionThreadPage } from "@/components/discussion";

export default async function Page({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params;
  return <DiscussionThreadPage key={threadId} threadId={threadId} />;
}
