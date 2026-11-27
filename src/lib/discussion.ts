import type { ContentMeta } from "./client/api";

export const discussionReactions = {
  WONDERING: "I’m wondering this too",
  MAKES_SENSE: "This makes sense",
  AGREE: "I agree",
  DISAGREE: "I disagree",
} as const;

export type DiscussionReactionKind = keyof typeof discussionReactions;
export type DiscussionReactionSummary = {
  counts: Record<DiscussionReactionKind, number>;
  selected: DiscussionReactionKind | null;
};

export type DiscussionThread = ContentMeta & {
  title: string;
  type: "QUESTION" | "ADVICE";
  assessment: { id: string; title: string } | null;
  pinned: boolean;
  replyCount: number;
};

export type DiscussionReply = ContentMeta & {
  body: string;
  replyTo: { id: string; author: string } | null;
  replyTargetUnavailable: boolean;
  endorsed: boolean;
  reactions: DiscussionReactionSummary;
};

export type DiscussionThreadList = {
  threads: DiscussionThread[];
  nextCursor: string | null;
};

export type DiscussionDetail = {
  thread: DiscussionThread & { body: string; reactions: DiscussionReactionSummary };
  replies: DiscussionReply[];
  nextCursor: string | null;
  linkedReply: DiscussionReply | null;
};
