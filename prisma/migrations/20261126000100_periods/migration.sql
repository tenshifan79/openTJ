CREATE TABLE "CoursePeriod" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  CONSTRAINT "CoursePeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CoursePeriod_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CoursePeriod_id_courseId_key" ON "CoursePeriod" ("id", "courseId");
CREATE UNIQUE INDEX "CoursePeriod_courseId_label_key" ON "CoursePeriod" ("courseId", "label");
CREATE UNIQUE INDEX "CoursePeriod_courseId_normalized_label_key" ON "CoursePeriod" ("courseId", lower("label"));

ALTER TABLE "CourseMembership" ADD COLUMN "periodId" TEXT;
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_periodId_courseId_fkey"
  FOREIGN KEY ("periodId", "courseId") REFERENCES "CoursePeriod" ("id", "courseId") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "CourseMembership" ADD CONSTRAINT "CourseMembership_staff_period_check"
  CHECK ("role" <> 'STAFF' OR "periodId" IS NULL);
CREATE INDEX "CourseMembership_periodId_courseId_idx" ON "CourseMembership" ("periodId", "courseId");

ALTER TABLE "CalendarEvent"
  ADD COLUMN "periodId" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_periodId_courseId_fkey"
  FOREIGN KEY ("periodId", "courseId") REFERENCES "CoursePeriod" ("id", "courseId") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "CalendarEvent_periodId_courseId_idx" ON "CalendarEvent" ("periodId", "courseId");
CREATE INDEX "CalendarEvent_assessmentId_courseId_periodId_idx" ON "CalendarEvent" ("assessmentId", "courseId", "periodId");
DROP INDEX "CalendarEvent_assessmentId_courseId_key";
CREATE UNIQUE INDEX "CalendarEvent_active_shared_assessment_key" ON "CalendarEvent" ("assessmentId", "courseId")
  WHERE "assessmentId" IS NOT NULL AND "periodId" IS NULL AND "removedAt" IS NULL;
CREATE UNIQUE INDEX "CalendarEvent_active_period_assessment_key" ON "CalendarEvent" ("assessmentId", "courseId", "periodId")
  WHERE "assessmentId" IS NOT NULL AND "periodId" IS NOT NULL AND "removedAt" IS NULL;

INSERT INTO "CoursePeriod" ("id", "courseId", "label")
SELECT "id" || '-p4', "id", 'Period 4'
FROM "Course" WHERE "slug" = 'concrete-math-av-p4';

UPDATE "CourseMembership" AS member SET "periodId" = period."id"
FROM "CoursePeriod" AS period
WHERE period."courseId" = member."courseId" AND member."role" = 'MEMBER';

UPDATE "CalendarEvent" AS event SET "periodId" = period."id"
FROM "CoursePeriod" AS period
WHERE period."courseId" = event."courseId";
