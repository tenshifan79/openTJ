"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CourseTabs } from "@/components/course-tabs";
import { PageHeading } from "@/components/page-heading";
import { AsyncForm, Modal, Panel } from "@/components/ui";
import { api, type CoursePeriod } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";

type Member = {
  id: string;
  role: "MEMBER" | "STAFF";
  periodId: string | null;
  user: { displayName: string; username: string };
};

export default function CourseSettingsPage() {
  const { data, slug, refresh } = useAppData();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [showRotation, setShowRotation] = useState(false);
  const [editDetails, setEditDetails] = useState(false);
  const [periodForm, setPeriodForm] = useState<CoursePeriod | "new" | null>(null);
  const [memberForm, setMemberForm] = useState<Member | "new" | null>(null);
  const [removeMember, setRemoveMember] = useState<Member | null>(null);
  const isStaff = data?.permissions.canModerate ?? false;
  const isAdmin = data?.permissions.isAdmin ?? false;
  const coursePath = `/courses/${slug}`;
  const loadMembers = useCallback(async (signal?: AbortSignal) => {
    const result = await api<{ members: Member[] }>(`${coursePath}/members`, { signal });
    if (!signal?.aborted) setMembers(result.members);
  }, [coursePath]);

  useEffect(() => {
    if (!isStaff) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      void loadMembers(controller.signal).catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load members.");
      });
    });
    return () => controller.abort();
  }, [isStaff, loadMembers]);

  if (!isStaff) return <>
    <PageHeading course title="Course settings" />
    <CourseTabs />
    <p className="notice" role="status">Course staff manage these settings.</p>
  </>;

  const periods = data?.periods ?? [];
  const periodName = (id: string | null) => periods.find((period) => period.id === id)?.label ?? "Unassigned";
  const editingMember = memberForm && memberForm !== "new" ? memberForm : null;
  const editingPeriod = periodForm && periodForm !== "new" ? periodForm : null;

  return <>
    <PageHeading course title="Course settings" action={<Link className="button" href="/moderation">Moderation</Link>} />
    <CourseTabs />
    {error && <p className="notice notice-warning" role="alert">{error}</p>}
    <div className="dashboard-grid">
      <Panel title="Members" action={<button className="button" type="button" onClick={() => setMemberForm("new")}>Add member</button>}>
        {!members ? <p role="status">Loading members…</p> : members.length ? <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Period</th><th scope="col">Role</th><th scope="col">Actions</th></tr></thead>
            <tbody>{members.map((member) => <tr key={member.id}>
              <td>{member.user.displayName} <span className="muted">@{member.user.username}</span></td>
              <td>{member.role === "STAFF" ? "All periods" : periodName(member.periodId)}</td>
              <td>{member.role === "STAFF" ? "Course staff" : "Member"}</td>
              <td>{(isAdmin || member.role !== "STAFF") && <div className="split wrap">
                <button aria-label={`Edit ${member.user.displayName}`} className="button" type="button" onClick={() => setMemberForm(member)}>Edit</button>
                <button aria-label={`Remove ${member.user.displayName}`} className="button" type="button" onClick={() => setRemoveMember(member)}>Remove</button>
              </div>}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="empty-state">No members yet.</p>}
      </Panel>
      <div className="stack">
        <Panel title="Class details" action={<button className="button" type="button" onClick={() => setEditDetails(true)}>Edit details</button>}>
          <p>{data?.course.name}</p>
          {data?.course.description && <p>{data.course.description}</p>}
        </Panel>
        <Panel title="Periods" action={<button className="button" type="button" onClick={() => setPeriodForm("new")}>Add period</button>}>
          {periods.length ? <ul className="item-list">{periods.map((period) => <li key={period.id}>
            <div className="split wrap"><span>{period.label}</span><button aria-label={`Rename ${period.label}`} className="button" type="button" onClick={() => setPeriodForm(period)}>Rename</button></div>
          </li>)}</ul> : <p className="empty-state">No periods yet.</p>}
        </Panel>
        <Panel title="Join code">
          <div className="stack">
            <button className="button" type="button" onClick={() => setShowRotation(true)}>Generate join code</button>
            {joinCode && <div className="split wrap">
              <output aria-label="Join code" className="join-code">{joinCode}</output>
              {typeof navigator !== "undefined" && navigator.clipboard && <button className="button" type="button" onClick={async () => {
                try { await navigator.clipboard.writeText(joinCode); setCopied(true); } catch { setError("Select the join code to copy it."); }
              }}>{copied ? "Copied" : "Copy code"}</button>}
            </div>}
          </div>
        </Panel>
      </div>
    </div>
    {editDetails && <Modal open title="Edit class details" onClose={() => setEditDetails(false)}>
      <AsyncForm label="Save details" onCancel={() => setEditDetails(false)} onSubmit={async form => {
        await api(coursePath, { method: "PATCH", body: { name: form.get("name"), description: form.get("description") } });
        await refresh();
        setEditDetails(false);
      }}>
        <label className="field"><span>Class name</span><input className="input" defaultValue={data?.course.name} name="name" maxLength={120} required /></label>
        <label className="field"><span>Description</span><textarea className="textarea" defaultValue={data?.course.description} name="description" maxLength={5000} rows={4} /></label>
      </AsyncForm>
    </Modal>}
    {periodForm && <Modal open title={editingPeriod ? "Rename period" : "Add period"} onClose={() => setPeriodForm(null)}>
      <AsyncForm label={editingPeriod ? "Save name" : "Add period"} onCancel={() => setPeriodForm(null)} onSubmit={async (form) => {
        await api(`${coursePath}/periods`, { body: { id: editingPeriod?.id, label: form.get("label") } });
        await refresh();
        setPeriodForm(null);
      }}>
        <label className="field"><span>Period name</span><input className="input" defaultValue={editingPeriod?.label} name="label" maxLength={40} required /></label>
      </AsyncForm>
    </Modal>}
    {memberForm && <Modal open title={editingMember ? "Edit membership" : "Add member"} onClose={() => setMemberForm(null)}>
      <AsyncForm label={editingMember ? "Save membership" : "Add member"} onCancel={() => setMemberForm(null)} onSubmit={async (form) => {
        await api(`${coursePath}/members`, { body: {
          username: editingMember?.user.username ?? form.get("username"),
          role: form.get("role") ?? "MEMBER",
          periodId: form.get("periodId") || null,
        } });
        await Promise.all([loadMembers(), refresh()]);
        setMemberForm(null);
      }}>
        {editingMember ? <p>{editingMember.user.displayName}</p> : <label className="field"><span>Ion username</span><input className="input" name="username" maxLength={100} required /></label>}
        {isAdmin && <label className="field"><span>Role</span><select className="select" name="role" defaultValue={editingMember?.role ?? "MEMBER"}>
          <option value="MEMBER">Member</option><option value="STAFF">Course staff</option>
        </select></label>}
        <label className="field"><span>Period</span><select className="select" name="periodId" defaultValue={editingMember?.periodId ?? ""}>
          <option value="">Unassigned</option>
          {periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
        </select></label>
      </AsyncForm>
    </Modal>}
    {removeMember && <Modal open title="Remove member" onClose={() => setRemoveMember(null)}>
      <AsyncForm label="Remove member" onCancel={() => setRemoveMember(null)} onSubmit={async () => {
        await api(`${coursePath}/members`, { body: { username: removeMember.user.username, remove: true } });
        await Promise.all([loadMembers(), refresh()]);
        setRemoveMember(null);
      }}>
        <p>{removeMember.user.displayName} will lose access to this course.</p>
      </AsyncForm>
    </Modal>}
    {showRotation && <Modal open title="Generate join code" onClose={() => setShowRotation(false)}>
      <AsyncForm label="Generate code" onCancel={() => setShowRotation(false)} onSubmit={async () => {
        const result = await api<{ code: string }>(`${coursePath}/join-code`, { body: {} });
        setJoinCode(result.code);
        setCopied(false);
        setShowRotation(false);
      }}>
        <p>Previous join codes for this course will stop working.</p>
      </AsyncForm>
    </Modal>}
  </>;
}
