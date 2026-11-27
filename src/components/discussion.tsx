"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";
import {
  discussionReactions,
  type DiscussionDetail,
  type DiscussionReactionKind,
  type DiscussionReactionSummary,
  type DiscussionReply,
  type DiscussionThreadList,
} from "@/lib/discussion";
import { ContributionMeta } from "./contribution-meta";
import { ContributionPolicyConsent, useContributionPolicy } from "./contribution-policy-consent";
import { CourseTabs } from "./course-tabs";
import { PageHeading } from "./page-heading";
import { RichContent } from "./rich-content";
import { AsyncForm, Badge, Modal, Panel } from "./ui";
import styles from "./discussion.module.css";

function useDiscussionRequest<T>(path: string, identity = path) {
  const [response, setResponse] = useState<{ identity: string; data: T }>();
  const [failure, setFailure] = useState<{ identity: string; error: string }>();
  const generation = useRef(0);
  const reload = useCallback(async (signal?: AbortSignal) => {
    const requestGeneration = ++generation.current;
    try {
      const data = await api<T>(path, { signal });
      if (!signal?.aborted && requestGeneration === generation.current) {
        setResponse({ identity, data });
        setFailure(undefined);
      }
    } catch (error) {
      if (!signal?.aborted && requestGeneration === generation.current) {
        setResponse(undefined);
        setFailure({ identity, error: error instanceof Error ? error.message : "Unable to load discussion." });
      }
    }
  }, [identity, path]);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void reload(controller.signal); });
    return () => controller.abort();
  }, [reload]);
  return {
    data: response?.identity === identity ? response.data : undefined,
    error: failure?.identity === identity ? failure.error : undefined,
    reload,
    update: (apply: (data: T) => T) => setResponse((current) =>
      current?.identity === identity ? { identity, data: apply(current.data) } : current),
  };
}

function ThreadEditor({ endpoint, thread, close, saved }: {
  endpoint: string;
  thread?: DiscussionDetail["thread"];
  close: () => void;
  saved: (id: string) => void | Promise<void>;
}) {
  const { data, refresh } = useAppData();
  const { needsConsent, acceptPolicy } = useContributionPolicy();
  const assessments = data?.assessments.filter((assessment) => assessment.visibility === "PUBLISHED") ?? [];
  return <Modal open onClose={close} title={thread ? "Edit thread" : "New thread"}>
    <AsyncForm label={thread ? "Save" : "Post thread"} onCancel={close} onSubmit={async (form) => {
      await acceptPolicy(form);
      const selectedAssessment = String(form.get("assessment") || "");
      const result = await api<{ id: string }>(endpoint, {
        method: thread ? "PATCH" : "POST",
        body: {
          title: form.get("title"), type: form.get("type"), body: form.get("body"),
          assessmentId: selectedAssessment || (thread && !thread.assessment ? undefined : null),
          ...(thread ? { version: thread.version } : {}),
        },
      });
      if (needsConsent) await refresh();
      await saved(result.id);
    }}>
      <label className="field"><span>Title</span><input className="input" name="title" defaultValue={thread?.title} maxLength={200} required /></label>
      <label className="field"><span>Type</span><select className="select" name="type" defaultValue={thread?.type ?? "QUESTION"}>
        <option value="QUESTION">Question</option><option value="ADVICE">Advice</option>
      </select></label>
      {assessments.length || thread?.assessment ? <label className="field"><span>Assessment</span>
        <select className="select" name="assessment" defaultValue={thread?.assessment?.id ?? ""}>
          <option value="">None</option>
          {assessments.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          {thread?.assessment && !assessments.some((item) => item.id === thread.assessment?.id)
            ? <option value={thread.assessment.id}>{thread.assessment.title}</option> : null}
        </select>
      </label> : null}
      <label className="field"><span>Post</span><textarea className="textarea" defaultValue={thread?.body} name="body" rows={8} maxLength={30_000} required /></label>
      {needsConsent ? <ContributionPolicyConsent /> : null}
    </AsyncForm>
  </Modal>;
}

function ReplyEditor({ endpoint, reply, replyTo, close, saved }: {
  endpoint: string;
  reply?: DiscussionReply;
  replyTo?: DiscussionReply;
  close: () => void;
  saved: (id: string) => void | Promise<void>;
}) {
  const { refresh } = useAppData();
  const { needsConsent, acceptPolicy } = useContributionPolicy();
  const title = reply ? "Edit reply" : replyTo ? `Reply to ${replyTo.author}` : "Reply";
  return <Modal open onClose={close} title={title}>
    <AsyncForm label={reply ? "Save" : "Post reply"} onCancel={close} onSubmit={async (form) => {
      await acceptPolicy(form);
      const result = await api<{ id: string }>(reply ? `${endpoint}/${reply.id}` : endpoint, {
        method: reply ? "PATCH" : "POST",
        body: { body: form.get("body"), ...(reply ? { version: reply.version } : { replyToId: replyTo?.id }) },
      });
      if (needsConsent) await refresh();
      await saved(result.id);
    }}>
      <label className="field"><span>Reply</span><textarea className="textarea" defaultValue={reply?.body} name="body" rows={7} maxLength={30_000} required /></label>
      {needsConsent ? <ContributionPolicyConsent /> : null}
    </AsyncForm>
  </Modal>;
}

function ReactionButtons({ endpoint, contentId, summary, changed }: {
  endpoint: string;
  contentId: string;
  summary: DiscussionReactionSummary;
  changed: (summary: DiscussionReactionSummary) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function select(kind: DiscussionReactionKind) {
    setPending(true);
    setError("");
    try {
      const result = await api<DiscussionReactionSummary>(endpoint, {
        method: "PUT", body: { contentId, kind: summary.selected === kind ? null : kind },
      });
      changed(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update reaction.");
    } finally {
      setPending(false);
    }
  }
  return <div className={styles.reactions} role="group" aria-label="Reactions">
    {(Object.keys(discussionReactions) as DiscussionReactionKind[]).map((kind) =>
      <button aria-pressed={summary.selected === kind} className={`button ${styles.reaction}`} disabled={pending}
        key={kind} onClick={() => void select(kind)} type="button">
        {discussionReactions[kind]}{summary.counts[kind] ? <span className={styles.count}>{summary.counts[kind]}</span> : null}
      </button>
    )}
    {error ? <p className="notice notice-warning" role="alert">{error}</p> : null}
  </div>;
}

export function DiscussionPage() {
  const { slug } = useAppData();
  const router = useRouter();
  const [unanswered, setUnanswered] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pagePending, setPagePending] = useState(false);
  const [pageError, setPageError] = useState("");
  const endpoint = `/courses/${slug}/discussion`;
  const path = `${endpoint}?unanswered=${unanswered ? "1" : "0"}`;
  const request = useDiscussionRequest<DiscussionThreadList>(path);

  async function nextPage() {
    if (!request.data?.nextCursor) return;
    setPagePending(true);
    setPageError("");
    try {
      const next = await api<DiscussionThreadList>(`${path}&cursor=${encodeURIComponent(request.data.nextCursor)}`);
      request.update((current) => ({
        threads: [...current.threads, ...next.threads.filter((item) => !current.threads.some((existing) => existing.id === item.id))],
        nextCursor: next.nextCursor,
      }));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : "Could not load more threads.");
    } finally {
      setPagePending(false);
    }
  }

  return <>
    <PageHeading course title="Discussion" action={<button className="button button-primary" onClick={() => setEditorOpen(true)} type="button">New thread</button>} />
    <CourseTabs />
    <div className={styles.toolbar} role="group" aria-label="Filter discussion">
      <button aria-pressed={!unanswered} className="button" onClick={() => { setUnanswered(false); setPageError(""); }} type="button">All threads</button>
      <button aria-pressed={unanswered} className="button" onClick={() => { setUnanswered(true); setPageError(""); }} type="button">Unanswered</button>
    </div>
    <div className="stack">
      {request.error ? <p className="notice notice-warning" role="alert">{request.error} <button className="link-button" onClick={() => void request.reload()} type="button">Retry</button></p> : null}
      {!request.data && !request.error ? <p role="status">Loading discussion…</p> : null}
      {request.data?.threads.map((thread) => <Panel key={thread.id}>
        <div className={styles.titleRow}>
          <h2><Link href={`${endpoint}/${thread.id}`}>{thread.title}</Link></h2>
          {thread.pinned ? <Badge tone="blue">Pinned</Badge> : null}
          {thread.locked ? <Badge tone="warning">Locked</Badge> : null}
          {thread.visibility !== "PUBLISHED" ? <Badge tone="warning">Hidden</Badge> : null}
        </div>
        <div className={styles.threadDetails}>
          <span>{thread.type === "QUESTION" ? "Question" : "Advice"}</span>
          <span>{thread.author}</span>
          {thread.assessment ? <span>{thread.assessment.title}</span> : null}
          <span>{thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}</span>
        </div>
      </Panel>)}
      {request.data?.threads.length === 0 ? <Panel><p className="empty-state">{unanswered ? "No unanswered questions." : "No threads yet."}</p></Panel> : null}
      {pageError ? <p className="notice notice-warning" role="alert">{pageError}</p> : null}
      {request.data?.nextCursor ? <button className="button" disabled={pagePending} onClick={() => void nextPage()} type="button">{pagePending ? "Loading…" : "More threads"}</button> : null}
    </div>
    {editorOpen ? <ThreadEditor close={() => setEditorOpen(false)} endpoint={endpoint} saved={(id) => {
      setEditorOpen(false);
      router.push(`${endpoint}/${id}`);
    }} /> : null}
  </>;
}

export function DiscussionThreadPage({ threadId }: { threadId: string }) {
  const { slug, data, linkedId } = useAppData();
  const [threadEditing, setThreadEditing] = useState(false);
  const [replyEditor, setReplyEditor] = useState<{ edit?: DiscussionReply; to?: DiscussionReply }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const discussionPath = `/courses/${slug}/discussion`;
  const endpoint = `${discussionPath}/${encodeURIComponent(threadId)}`;
  const target = linkedId !== threadId && /^[a-zA-Z0-9_-]{1,200}$/.test(linkedId) ? linkedId : "";
  const request = useDiscussionRequest<DiscussionDetail>(target ? `${endpoint}?target=${encodeURIComponent(target)}` : endpoint, endpoint);
  const thread = request.data?.thread;
  const staff = Boolean(data?.permissions.canModerate);
  const published = thread?.visibility === "PUBLISHED";
  const replied = request.data?.replies.some(item => item.id === target);
  const linked = request.data?.linkedReply;
  const targetVisible = Boolean(target && (replied || linked?.id === target));
  useEffect(() => {
    if (!targetVisible) return;
    const frame = requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [target, targetVisible]);

  async function loadMore() {
    if (!request.data?.nextCursor) return;
    setPending(true);
    setError("");
    try {
      const next = await api<DiscussionDetail>(`${endpoint}?cursor=${encodeURIComponent(request.data.nextCursor)}`);
      request.update((current) => ({
        ...current, nextCursor: next.nextCursor,
        replies: [...current.replies, ...next.replies.filter((item) => !current.replies.some((existing) => existing.id === item.id))],
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load more replies.");
    } finally {
      setPending(false);
    }
  }

  async function staffAction(body: { action: "PIN"; pinned: boolean } | { action: "ENDORSE"; replyId: string | null }) {
    setPending(true);
    setError("");
    try {
      await api(`${endpoint}/staff`, { method: "PATCH", body });
      await request.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the discussion.");
    } finally {
      setPending(false);
    }
  }

  function reaction(contentId: string, summary: DiscussionReactionSummary) {
    request.update((current) => {
      const updated = (reply: DiscussionReply) => reply.id === contentId ? { ...reply, reactions: summary } : reply;
      return {
        ...current,
        thread: current.thread.id === contentId ? { ...current.thread, reactions: summary } : current.thread,
        replies: current.replies.map(updated),
        linkedReply: current.linkedReply ? updated(current.linkedReply) : null,
      };
    });
  }

  function replyCard(reply: DiscussionReply) {
    const replyPublished = published && reply.visibility === "PUBLISHED";
    return <article className={styles.reply} id={reply.id} key={reply.id}>
      <Panel>
        {reply.endorsed ? <Badge tone="success">Endorsed by staff</Badge> : null}
        {reply.replyTo ? <p className="muted small">In reply to <a href={`#${reply.replyTo.id}`}>{reply.replyTo.author}</a></p> : null}
        {reply.replyTargetUnavailable ? <p className="muted small">Earlier reply unavailable</p> : null}
        <RichContent source={reply.body} />
        <ContributionMeta item={reply} kind="DISCUSSION_REPLY" editingAllowed={Boolean(published && (!thread?.locked || staff))}
          onChanged={request.reload} onEdit={() => setReplyEditor({ edit: reply })} />
        {replyPublished ? <>
          <ReactionButtons endpoint={`${endpoint}/reactions`} contentId={reply.id} summary={reply.reactions}
            changed={(summary) => reaction(reply.id, summary)} />
          <div className={styles.toolbar}>
            {!thread?.locked ? <button className="button" onClick={() => setReplyEditor({ to: reply })} type="button">Reply</button> : null}
            {staff ? <button className="button" disabled={pending} onClick={() => void staffAction({ action: "ENDORSE", replyId: reply.endorsed ? null : reply.id })} type="button">
              {reply.endorsed ? "Remove endorsement" : "Endorse reply"}
            </button> : null}
          </div>
        </> : null}
      </Panel>
    </article>;
  }

  return <>
    <PageHeading course title={thread?.title ?? "Discussion"} />
    <CourseTabs />
    <div className="stack">
      <Link href={discussionPath}>All threads</Link>
      {!thread && !request.error ? <p role="status">Loading discussion…</p> : null}
      {request.error ? <p className="notice notice-warning" role="alert">{request.error} <button className="link-button" onClick={() => void request.reload()} type="button">Retry</button></p> : null}
      {thread ? <>
        <article id={thread.id}>
          <Panel>
            <div className={styles.toolbar}>
              <Badge tone="blue">{thread.type === "QUESTION" ? "Question" : "Advice"}</Badge>
              {thread.pinned ? <Badge tone="blue">Pinned</Badge> : null}
              {thread.assessment ? <Link href={`/courses/${slug}/assessments#${thread.assessment.id}`}>{thread.assessment.title}</Link> : null}
            </div>
            <RichContent source={thread.body} />
            <ContributionMeta item={thread} kind="ADVICE" allowOwnLock onChanged={request.reload} onEdit={() => setThreadEditing(true)} />
            {published ? <>
              <ReactionButtons endpoint={`${endpoint}/reactions`} contentId={thread.id} summary={thread.reactions}
                changed={(summary) => reaction(thread.id, summary)} />
              <div className={styles.toolbar}>
                {!thread.locked ? <button className="button button-primary" onClick={() => setReplyEditor({})} type="button">Reply</button> : null}
                {staff ? <button className="button" disabled={pending} onClick={() => void staffAction({ action: "PIN", pinned: !thread.pinned })} type="button">
                  {thread.pinned ? "Unpin thread" : "Pin thread"}
                </button> : null}
              </div>
            </> : null}
          </Panel>
        </article>
        {linked && linked.id === target && !replied ? <section aria-label="Linked reply">{replyCard(linked)}</section> : null}
        {published || staff ? <section className="stack" aria-labelledby="discussion-replies">
          <h2 id="discussion-replies">Replies</h2>
          {request.data?.replies.map(replyCard)}
          {!request.data?.replies.length ? <p className="empty-state">No replies yet.</p> : null}
          {request.data?.nextCursor ? <button className="button" disabled={pending} onClick={() => void loadMore()} type="button">{pending ? "Loading…" : "More replies"}</button> : null}
        </section> : null}
        {error ? <p className="notice notice-warning" role="alert">{error}</p> : null}
        {threadEditing ? <ThreadEditor close={() => setThreadEditing(false)} endpoint={endpoint} thread={thread} saved={async () => {
          setThreadEditing(false);
          await request.reload();
        }} /> : null}
        {replyEditor ? <ReplyEditor close={() => setReplyEditor(undefined)} endpoint={`${endpoint}/replies`}
          reply={replyEditor.edit} replyTo={replyEditor.to} saved={async (id) => {
            setReplyEditor(undefined);
            if (window.location.hash !== `#${id}`) window.location.hash = id;
            else await request.reload();
          }} /> : null}
      </> : null}
    </div>
  </>;
}
