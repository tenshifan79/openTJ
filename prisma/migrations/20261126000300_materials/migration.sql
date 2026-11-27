ALTER TYPE "NoteMode" ADD VALUE 'GOOGLE';
CREATE TYPE "MaterialTag" AS ENUM ('NOTES', 'PRACTICE_ASSESSMENT', 'SAMPLE_QUESTIONS', 'OTHER');

ALTER TABLE "Note"
  ADD COLUMN "tag" "MaterialTag" NOT NULL DEFAULT 'NOTES',
  ADD COLUMN "googleUrl" TEXT,
  DROP CONSTRAINT "Note_representation_check",
  ADD CONSTRAINT "Note_representation_check" CHECK (
    ("mode"::text = 'PDF' AND "uploadId" IS NOT NULL AND "body" IS NULL AND "googleUrl" IS NULL) OR
    ("mode"::text = 'GOOGLE' AND "uploadId" IS NULL AND "body" IS NULL AND "googleUrl" IS NOT NULL) OR
    ("mode"::text IN ('PLAIN_TEXT', 'MARKDOWN_LATEX') AND "uploadId" IS NULL AND "body" IS NOT NULL AND "googleUrl" IS NULL)
  );

CREATE INDEX "Note_courseId_tag_idx" ON "Note" ("courseId", "tag");
