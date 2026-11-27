"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ContentEditor } from "@/components/content-editor";
import { ContributionMeta } from "@/components/contribution-meta";
import { CourseTabs } from "@/components/course-tabs";
import { PageHeading } from "@/components/page-heading";
import { RichContent } from "@/components/rich-content";
import { Badge, Panel } from "@/components/ui";
import { api, type Note } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";
import { googleMaterialLink, materialTags, type MaterialTag } from "@/lib/materials";

type MaterialPage = { items: Note[]; nextCursor: string | null };

function GoogleMaterial({ note }: { note: Note }) {
  const [preview, setPreview] = useState(false);
  const link = googleMaterialLink(note.googleUrl ?? "");
  if (!link) return null;
  return <>
    <div className="content-controls">
      <a className="button" href={link.view} target="_blank" rel="noopener noreferrer">Open in Google</a>
      <button className="button" type="button" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? "Hide preview" : "Preview"}</button>
    </div>
    {preview && <iframe src={link.preview} title={`Preview: ${note.title}`} referrerPolicy="no-referrer" loading="lazy" style={{ display: "block", width: "100%", minHeight: 440, marginTop: 10, border: 0 }} />}
  </>;
}

function MaterialBody({ note }: { note: Note }) {
  if (note.mode === "Google link") return <GoogleMaterial key={note.googleUrl} note={note} />;
  if (note.mode === "Plain text") return <p className="plain-content">{note.body}</p>;
  if (note.mode === "Markdown + LaTeX") return <RichContent source={note.body} />;
  if (note.uploadId && note.uploadStatus === "CLEAN" && note.visibility === "PUBLISHED") {
    return <a className="button" href={`/api/v1/uploads/${note.uploadId}/view`} target="_blank" rel="noopener noreferrer">Open PDF</a>;
  }
  if (note.uploadStatus === "CLEAN") return null;
  return <p className="muted">{["REJECTED", "FAILED"].includes(note.uploadStatus ?? "") ? "PDF unavailable." : "PDF awaiting review."}</p>;
}

export default function MaterialsPage() {
  const { data, linkedId, slug, refresh } = useAppData();
  const notes = data?.notes;
  const [open, setOpen] = useState(false);
  const [tag, setTag] = useState<MaterialTag | "">("");
  const [page, setPage] = useState<MaterialPage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const path = `/courses/${encodeURIComponent(slug)}/materials?limit=25${tag ? `&tag=${tag}` : ""}`;

  useEffect(() => {
    const request = new AbortController();
    void api<MaterialPage>(path, { signal: request.signal }).then(result => {
      if (!request.signal.aborted) { setPage(result); setError(""); }
    }).catch((reason: unknown) => {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load materials.");
    });
    return () => request.abort();
  }, [path, notes]);

  const pendingPdf = page?.items.some(note => note.visibility === "QUARANTINED");
  useEffect(() => {
    if (!pendingPdf || !data?.permissions.pdfUploadsEnabled) return;
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => clearInterval(timer);
  }, [pendingPdf, refresh, data?.permissions.pdfUploadsEnabled]);

  const linked = notes?.find(note => note.id === linkedId);
  const items = page?.items ?? [];
  const displayed = linked && !items.some(note => note.id === linkedId) ? [linked, ...items] : items;
  useEffect(() => {
    if (!linkedId) return;
    const frame = requestAnimationFrame(() => document.getElementById(linkedId)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [linkedId, page, linked]);

  const banks = data?.banks ?? [];
  const showBanks = (!tag || tag === "SAMPLE_QUESTIONS") && banks.length > 0;
  return <>
    <PageHeading course title="Materials" action={<button className="button button-primary" onClick={() => setOpen(true)} type="button">Add material</button>} />
    <CourseTabs />
    <label className="field filter-field"><span>Tag</span><select className="select" value={tag} onChange={event => {
      setTag(event.target.value as MaterialTag | ""); setPage(null); setError("");
    }}>
      <option value="">All materials</option>
      {Object.entries(materialTags).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <div className="stack">
      {showBanks && <Panel title="Sample question banks"><ul className="item-list">{banks.map(bank => <li key={bank.id}><Link href={`/courses/${slug}/questions?assessment=${encodeURIComponent(bank.assessmentId)}`}>{bank.title ?? "Practice"}</Link></li>)}</ul></Panel>}
      {displayed.map(note => <article id={note.id} key={note.id}>
        <Panel title={note.title} action={<Badge>{materialTags[note.tag]}</Badge>}>
          <MaterialBody note={note} />
          <ContributionMeta item={note} kind="NOTE" />
        </Panel>
      </article>)}
      {page && !displayed.length && !showBanks && <Panel><p className="empty-state">No materials yet.</p></Panel>}
      {!page && !error && <p role="status">Loading materials…</p>}
      {error && <p className="notice notice-warning" role="alert">{error}</p>}
      {page?.nextCursor && <div><button className="button" disabled={loadingMore} type="button" onClick={async () => {
        setLoadingMore(true);
        try {
          const cursor = page.nextCursor;
          const more = await api<MaterialPage>(`${path}&cursor=${encodeURIComponent(cursor!)}`);
          setPage(current => current?.nextCursor === cursor ? { items: [...current.items, ...more.items.filter(note => !current.items.some(prior => prior.id === note.id))], nextCursor: more.nextCursor } : current);
          setError("");
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load more materials."); }
        finally { setLoadingMore(false); }
      }}>{loadingMore ? "Loading…" : "Load more materials"}</button></div>}
    </div>
    {open && <ContentEditor kind="NOTE" onClose={() => setOpen(false)} />}
  </>;
}
