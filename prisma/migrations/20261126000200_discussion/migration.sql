ALTER TYPE "ContentKind" ADD VALUE 'DISCUSSION_REPLY' BEFORE 'QUESTION';
ALTER TYPE "AdviceType" ADD VALUE 'QUESTION';
CREATE TYPE "DiscussionReactionKind" AS ENUM ('WONDERING', 'MAKES_SENSE', 'AGREE', 'DISAGREE');

ALTER TABLE "AdvicePost" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "AdvicePost" DROP CONSTRAINT "AdvicePost_assessment_check";
ALTER TABLE "AdvicePost" ADD CONSTRAINT "AdvicePost_assessment_check" CHECK (
  ("type" = 'GENERAL' AND "assessmentId" IS NULL) OR
  ("type" = 'ASSESSMENT_SPECIFIC' AND "assessmentId" IS NOT NULL) OR
  "type"::text = 'QUESTION'
);

CREATE TABLE "DiscussionReply" (
  "contentItemId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "threadId" TEXT NOT NULL,
  "replyToId" TEXT,
  "body" TEXT NOT NULL,
  "endorsedAt" TIMESTAMP(3),
  "endorsedById" TEXT,
  CONSTRAINT "DiscussionReply_pkey" PRIMARY KEY ("contentItemId"),
  CONSTRAINT "DiscussionReply_no_self_reply" CHECK ("replyToId" <> "contentItemId"),
  CONSTRAINT "DiscussionReply_endorsement_check" CHECK ("endorsedById" IS NULL OR "endorsedAt" IS NOT NULL)
);
CREATE UNIQUE INDEX "DiscussionReply_contentItemId_courseId_key" ON "DiscussionReply" ("contentItemId", "courseId");
CREATE UNIQUE INDEX "DiscussionReply_contentItemId_threadId_key" ON "DiscussionReply" ("contentItemId", "threadId");
CREATE UNIQUE INDEX "DiscussionReply_one_endorsement" ON "DiscussionReply" ("threadId") WHERE "endorsedAt" IS NOT NULL;
CREATE INDEX "DiscussionReply_courseId_threadId_idx" ON "DiscussionReply" ("courseId", "threadId");
CREATE INDEX "DiscussionReply_replyToId_idx" ON "DiscussionReply" ("replyToId");
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_contentItemId_courseId_fkey" FOREIGN KEY ("contentItemId", "courseId") REFERENCES "ContentItem" ("id", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_threadId_courseId_fkey" FOREIGN KEY ("threadId", "courseId") REFERENCES "AdvicePost" ("contentItemId", "courseId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_replyToId_threadId_fkey" FOREIGN KEY ("replyToId", "threadId") REFERENCES "DiscussionReply" ("contentItemId", "threadId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "DiscussionReply" ADD CONSTRAINT "DiscussionReply_endorsedById_fkey" FOREIGN KEY ("endorsedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TRIGGER "DiscussionReply_kind_check" BEFORE INSERT OR UPDATE ON "DiscussionReply" FOR EACH ROW EXECUTE FUNCTION enforce_content_kind('DISCUSSION_REPLY');

CREATE TABLE "DiscussionReaction" (
  "contentItemId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" "DiscussionReactionKind" NOT NULL,
  CONSTRAINT "DiscussionReaction_pkey" PRIMARY KEY ("contentItemId", "userId"),
  CONSTRAINT "DiscussionReaction_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DiscussionReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DiscussionReaction_userId_idx" ON "DiscussionReaction" ("userId");

CREATE FUNCTION enforce_discussion_reaction_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ContentItem" WHERE "id" = NEW."contentItemId" AND "kind"::text IN ('ADVICE', 'DISCUSSION_REPLY')) THEN
    RAISE EXCEPTION 'Reaction target must be a discussion post or reply' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DiscussionReaction_target_check" BEFORE INSERT OR UPDATE ON "DiscussionReaction" FOR EACH ROW EXECUTE FUNCTION enforce_discussion_reaction_target();
