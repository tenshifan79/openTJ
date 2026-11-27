"use client";

import { Flag, UserRound } from "lucide-react";
import { useState } from "react";
import { api, dateLabel, type ContentKind, type ContentMeta } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";
import { AsyncForm, Badge, Modal } from "./ui";
import { ContentEditor } from "./content-editor";

export function ContributionMeta({
  item, kind, eventId, onEdit, onChanged, editingAllowed = true, allowAuthorChanges = true, allowOwnLock = false,
}: {
  item: ContentMeta;
  kind: ContentKind;
  eventId?: string;
  onEdit?: () => void;
  onChanged?: () => void | Promise<void>;
  editingAllowed?: boolean;
  allowAuthorChanges?: boolean;
  allowOwnLock?: boolean;
}) {
  const { user, data, slug, mutate } = useAppData();
  const [action, setAction] = useState<string | null>(null);
  const [edit, setEdit] = useState<object | null>(null);
  const [error, setError] = useState<string | null>(null);
  const owner = user?.id === item.authorId;
  const mayChangeOwnedItem = owner && (allowAuthorChanges || data?.permissions.canModerate);
  const canEdit = editingAllowed && (mayChangeOwnedItem || data?.permissions.canModerate) && (!item.locked || data?.permissions.canModerate);
  const hidden = item.visibility.startsWith("HIDDEN");
  const ownLock = owner && allowOwnLock && !hidden;
  async function openEditor() {
    if (onEdit) {
      onEdit();
      return;
    }
    try {
      setError(null);
      setEdit(await api<object>(`/courses/${slug}/content/${item.id}/edit`));
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to open editor."); }
  }
  return <>
    <div className="meta contribution-meta">
      <span><UserRound aria-hidden="true" /> {item.author} (@{item.username})</span>
      <span>{dateLabel(item.createdAt)}</span>
      {item.visibility !== "PUBLISHED" ? <Badge tone="warning">{hidden ? "Hidden" : item.visibility.toLowerCase().replaceAll("_", " ")}</Badge> : null}
      {item.locked ? <Badge tone="warning">Locked</Badge> : null}
    </div>
    {item.parentHidden ? <p className="notice notice-warning">The parent assessment is hidden.</p> : null}
    {item.moderationReason ? <p className="notice notice-warning">Moderation reason: {item.moderationReason}</p> : null}
    <div className="content-controls">
      {canEdit && !hidden ? <button className="link-button" type="button" onClick={openEditor}>Edit</button> : null}
      {mayChangeOwnedItem && (!item.locked || data?.permissions.canModerate) && item.visibility !== "HIDDEN_BY_MODERATOR" ? <button className="link-button" type="button" onClick={() => setAction(hidden ? "restore" : "hide")}>{hidden ? "Restore" : "Hide"}</button> : null}
      {item.visibility === "PUBLISHED" ? <button className="link-button" onClick={() => setAction("report")} type="button"><Flag aria-hidden="true" /> Report</button> : null}
      {owner && item.visibility === "HIDDEN_BY_MODERATOR" ? <button className="link-button" type="button" onClick={() => setAction("appeal")}>Appeal takedown</button> : null}
      {data?.permissions.canModerate && (!owner || ownLock) ? <button className="link-button" type="button" onClick={() => setAction("moderate")}>{ownLock ? item.locked ? "Unlock discussion" : "Lock discussion" : "Moderate"}</button> : null}
    </div>
    {error ? <p className="notice notice-warning" role="alert">{error}</p> : null}
    {edit ? <ContentEditor eventId={eventId} item={{ ...item, ...edit }} kind={kind} onClose={() => setEdit(null)} /> : null}
    <Modal open={Boolean(action)} onClose={() => setAction(null)} title={action === "report" ? "Report contribution" : action === "appeal" ? "Appeal takedown" : action === "moderate" ? "Moderate contribution" : `${action === "restore" ? "Restore" : "Hide"} contribution`}>
      <AsyncForm label={action === "report" ? "Submit report" : action === "appeal" ? "Submit appeal" : "Confirm"} onCancel={() => setAction(null)} onSubmit={async form => {
        if (action === "report") await mutate(`/courses/${slug}/reports`, { contentId: item.id, reason: form.get("reason"), details: form.get("details") });
        else if (action === "appeal") await mutate(`/courses/${slug}/appeals`, { contentId: item.id, message: form.get("details") });
        else if (action === "moderate") await mutate(`/courses/${slug}/moderation`, { contentId: item.id, version: item.version, action: form.get("moderationAction"), reason: form.get("details") });
        else await mutate(`/courses/${slug}/content/${item.id}/visibility`, { version: item.version, action });
        setAction(null);
        await onChanged?.();
      }}>
        {action === "report" ? <label className="field"><span>Reason</span><select className="select" name="reason">{[["ACADEMIC_INTEGRITY", "Assessment leak / academic integrity"], ["HARASSMENT_HATE", "Harassment or hate"], ["PRIVACY", "Personal information"], ["COPYRIGHT", "Copyright"], ["UNSAFE_FILE", "Unsafe file"], ["SPAM", "Spam"], ["OTHER", "Other"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : null}
        {action === "moderate" && ownLock ? <input name="moderationAction" type="hidden" value={item.locked ? "UNLOCK" : "LOCK"} /> : null}
        {action === "moderate" && !ownLock ? <label className="field"><span>Action</span><select className="select" name="moderationAction"><option value="HIDE">Hide</option><option value="RESTORE">Restore</option><option value="LOCK">{kind === "ADVICE" ? "Lock discussion" : "Lock edits"}</option><option value="UNLOCK">{kind === "ADVICE" ? "Unlock discussion" : "Unlock edits"}</option></select></label> : null}
        {["report", "appeal", "moderate"].includes(action ?? "") ? <label className="field"><span>{action === "appeal" ? "Explain why this should be restored (one appeal per takedown)" : "Details / reason"}</span><textarea className="textarea" name="details" required rows={4} maxLength={4000} /></label> : <p>{action === "restore" ? "This contribution will become visible to course members again." : "Hide this contribution from course members? You can restore it later."}</p>}
      </AsyncForm>
    </Modal>
  </>;
}
