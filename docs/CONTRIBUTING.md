# Contributing to OpenTJ

Follow the [README](../README.md) to start the local PostgreSQL and Next.js app. Use fictional accounts and a disposable database for HTTP and browser fixtures. Keep schema changes in new Prisma migrations. Read the installed Next.js documentation before changing routing, layouts, or request handling.

## Identity and permissions

Ion is the authority for account identity. Keep the stable Ion ID and refresh role flags from the authenticated profile. A numeric username prefix can identify a student when both flags are missing. Verified Ion teachers and counselors can create classes. Class creation grants staff membership of that class in the same transaction as the class, its periods, and its audit entry.

An active session and course membership govern access to course content. Course staff manage their own class, student roster, periods, join codes, and moderation. Staff assignment, class archiving, and platform account restrictions belong to platform administrators. Check these permissions in server services and route handlers. A client-side control merely reflects permission. Continue to use course-scoped foreign keys when linking records.

## Enrollment and dates

- A join code belongs to the whole class. Students select one configured period when joining. A repeat join preserves an assigned period. Staff can correct a student’s period. A legacy member without a period can select one from the course and can see any shared dates in the meantime.
- An assessment, its topics, and its question bank are shared. Each linked calendar occurrence is the date for one period or the shared date for the class. Use `calendarAudienceWhere` and the assessment serializer for consistent reads. A student’s period occurrence takes precedence over the shared occurrence. Hiding the matching occurrence leaves the date blank. Unscheduling it allows shared fallback.
- Students author and edit their own period dates. Courses without periods support shared student dates. Staff can schedule any period and confirm dates. A student’s subsequent date change clears confirmation. Apply the audience check to detail, history, and calendar updates as well as the calendar list. Timed events use Eastern time in the UI and are stored as instants. All-day events use date-only values.

## Content and moderation

Discussion and Materials are visible across enrolled periods. The existing advice and note records keep their contribution IDs as discussion threads and materials. Keep `ContentItem` ownership, versions, visibility, and reports available to the existing moderation and appeal flows. On a hidden thread, suppress replies and reaction counts for members. A reply can reference a comment in the same thread. Reactions are unique per member and contribution, with aggregate counts returned to clients. Search and direct URLs must apply the same visibility rules as the relevant section.

Materials can contain plain text, Markdown with math, or a supported Google file link. Validate and canonicalize Google URLs before storing them. Google controls preview and file access. Native practice retains revision-based grading and private attempt history. Existing approved PDFs still use the private storage and scan-state checks. Local scanner tests require `PDF_UPLOADS_ENABLED=true` on the running local server.

## Changes and verification

- Preserve contribution and event IDs for bookmarked URLs. When adding content types, update database subtype checks, serializers, moderation, search, and retention. Preserve answer keys inside question revisions.
- Verify the applicable checks in the README. For permission changes, exercise student, course staff, unrelated staff, and platform administrator paths. Include direct API reads and writes in addition to browser controls.
- Rehearse migrations against a copy of an older database before releasing. Verify the Concrete Math P4 enrollment and event backfill, legacy notes and discussion links, an approved PDF, moderation history, and student practice history. Back up the matching database and private objects before upgrading a deployment.
