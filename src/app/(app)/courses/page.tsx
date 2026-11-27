"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeading } from "@/components/page-heading";
import { AsyncForm, Badge, Modal, Panel } from "@/components/ui";
import { api, type CoursePeriod } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";

type Invitation = { name: string; needsPeriod: boolean; periods: CoursePeriod[] };

export default function CoursesPage() {
  const { courses, user, isAdmin, loading, error, refresh } = useAppData();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [invitation, setInvitation] = useState<(Invitation & { code: string }) | null>(null);

  async function join(code: string, periodId?: string) {
    const result = await api<{ slug: string }>("/courses/join", { body: { code, periodId } });
    await refresh();
    router.push(`/courses/${result.slug}`);
  }

  return <>
    <PageHeading title="Courses" action={user?.isTeacher || isAdmin
      ? <button className="button button-primary" onClick={() => setCreating(true)} type="button">Create course</button>
      : undefined} />
    {loading && <p role="status">Loading courses…</p>}
    {error && <p className="notice notice-warning" role="alert">{error}</p>}
    <div className="dashboard-grid">
      <div className="stack">
        {courses.map((course) => <Panel key={course.id} title={course.name} action={course.role === "STAFF"
          ? <Badge>Course staff</Badge>
          : course.periodLabel ? <Badge>{course.periodLabel}</Badge> : undefined}>
          {course.description && <p>{course.description}</p>}
          <div className="split wrap">
            <span className="muted">{course.memberCount ?? 0} {course.memberCount === 1 ? "member" : "members"}</span>
            {course.joined && <div className="split wrap">
              <Link className="button button-primary" href={`/courses/${course.slug}`}>Open course</Link>
              {(course.role === "STAFF" || isAdmin) && <Link className="button" href={`/courses/${course.slug}/settings`}>Course settings</Link>}
            </div>}
          </div>
        </Panel>)}
        {!loading && !courses.length && <p className="empty-state">No courses yet.</p>}
      </div>
      <Panel title="Join a course">
        <AsyncForm label="Join course" onSubmit={async (form) => {
          const code = String(form.get("code") ?? "").trim();
          const preview = await api<Invitation>("/courses/join", { body: { code, preview: true } });
          if (preview.needsPeriod) setInvitation({ ...preview, code });
          else await join(code);
        }}>
          <label className="field"><span>Course join code</span><input autoComplete="off" className="input" name="code" required maxLength={100} /></label>
        </AsyncForm>
      </Panel>
    </div>
    {invitation && <Modal open title={`Join ${invitation.name}`} onClose={() => setInvitation(null)}>
      <AsyncForm label="Join course" onCancel={() => setInvitation(null)} onSubmit={async (form) => {
        await join(invitation.code, String(form.get("periodId") ?? ""));
        setInvitation(null);
      }}>
        <label className="field"><span>Period</span>
          <select className="select" name="periodId" defaultValue="" required>
            <option value="" disabled>Choose a period</option>
            {invitation.periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
          </select>
        </label>
      </AsyncForm>
    </Modal>}
    {creating && <Modal open title="Create course" onClose={() => setCreating(false)}>
      <AsyncForm label="Create course" onCancel={() => setCreating(false)} onSubmit={async (form) => {
        const result = await api<{ slug: string }>("/courses", { body: {
          name: form.get("name"),
          description: form.get("description"),
          periods: String(form.get("periods") ?? "").split("\n").map((label) => label.trim()).filter(Boolean),
        } });
        await refresh();
        setCreating(false);
        router.push(`/courses/${result.slug}/settings`);
      }}>
        <label className="field"><span>Course name</span><input className="input" name="name" maxLength={120} required /></label>
        <label className="field"><span>Description (optional)</span><textarea className="textarea" name="description" rows={3} maxLength={5000} /></label>
        <label className="field"><span>Periods (one per line)</span><textarea className="textarea" name="periods" placeholder="Period 4" rows={3} required /></label>
      </AsyncForm>
    </Modal>}
  </>;
}
