"use client";

import { useState } from "react";
import Link from "next/link";
import { ContentEditor } from "@/components/content-editor";
import { ContributionPolicyConsent, useContributionPolicy } from "@/components/contribution-policy-consent";
import { CourseTabs } from "@/components/course-tabs";
import { ContributionMeta } from "@/components/contribution-meta";
import { PageHeading } from "@/components/page-heading";
import { RichContent } from "@/components/rich-content";
import { AsyncForm, Badge, Modal, Panel } from "@/components/ui";
import { dateLabel, scheduleStatus, type Assessment } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";

export default function AssessmentsPage() {
  const { data, slug, mutate } = useAppData();
  const { needsConsent, acceptPolicy } = useContributionPolicy();
  const [open, setOpen] = useState(false);
  const [scheduling, setScheduling] = useState<Assessment | null>(null);
  const isStaff = data?.permissions.canModerate ?? false;
  const periods = [{ id: "", label: "All periods" }, ...(data?.periods ?? [])];
  const availablePeriods = (item: Assessment) => periods.filter((period) => !item.occurrences?.some((event) => (event.periodId ?? "") === period.id));
  const calendarHref = (id: string) => `/courses/${slug}/calendar#${id}`;

  return <>
    <PageHeading course title="Assessments" action={<button className="button button-primary" onClick={() => setOpen(true)} type="button">Add assessment</button>} />
    <CourseTabs />
    <div className="stack">
      {data?.assessments.map((item) => <article id={item.id} key={item.id}>
        <Panel title={<span>{item.title} <Badge>{item.kind}</Badge></span>} action={item.major ? <Badge tone="blue">Major assessment</Badge> : undefined}>
          <div className="assessment-grid">
            <div className="stack">
              {item.summary && <p>{item.summary}</p>}
              {item.description && <RichContent source={item.description} />}
              {isStaff ? <ul className="item-list">
                {item.occurrences?.map((event) => <li key={event.id}>
                  <Link href={calendarHref(event.id)}>{periods.find((period) => period.id === (event.periodId ?? ""))?.label}</Link>
                  {" · "}{event.visibility === "PUBLISHED" ? dateLabel(event.date) : "Hidden"}
                  {event.visibility === "PUBLISHED" && <> <Badge tone={event.confirmedAt ? "success" : undefined}>{scheduleStatus(event)}</Badge></>}
                </li>)}
              </ul> : item.calendarEventId ? <div className="split wrap">
                <Link href={calendarHref(item.calendarEventId)}>{dateLabel(item.date)}</Link>
                <Badge tone={item.confirmedAt ? "success" : undefined}>{scheduleStatus(item)}</Badge>
              </div> : <p className="muted">No date scheduled.</p>}
              {item.visibility === "PUBLISHED" && (isStaff ? Boolean(availablePeriods(item).length) : !item.scheduledForPeriod)
                && <div><button className="button" onClick={() => setScheduling(item)} type="button">Add to calendar</button></div>}
              {item.major && <p><Link href={`/courses/${slug}/questions?assessment=${item.id}`}>Open question bank</Link></p>}
            </div>
            {item.topics.length > 0 && <div className="nested-card"><h3>Topics</h3><ul>{item.topics.map((topic, index) => <li key={index}>{topic}</li>)}</ul></div>}
            {item.templates.length > 0 && <div className="nested-card"><h3>Question templates</h3><ul>{item.templates.map((template, index) => <li key={index}>{template}</li>)}</ul></div>}
          </div>
          <ContributionMeta item={item} kind="ASSESSMENT" />
        </Panel>
      </article>)}
      {!data?.assessments.length && <Panel><p className="empty-state">No assessments yet.</p></Panel>}
    </div>
    {open && <ContentEditor kind="ASSESSMENT" onClose={() => setOpen(false)} />}
    {scheduling && <Modal open title="Add assessment to calendar" onClose={() => setScheduling(null)}>
      <AsyncForm label="Add to calendar" onCancel={() => setScheduling(null)} onSubmit={async (form) => {
        await acceptPolicy(form);
        await mutate(`/courses/${slug}/assessments/${scheduling.id}/calendar`, {
          title: scheduling.title, start: form.get("start"), kind: "assessment", details: scheduling.summary, allDay: true,
          ...(isStaff ? { periodId: form.get("periodId") || null } : {}),
        });
        setScheduling(null);
      }}>
        <p>{scheduling.title}</p>
        <label className="field"><span>Date</span><input className="input" name="start" required type="date" /></label>
        {isStaff && periods.length > 1 && <label className="field"><span>Period</span>
          <select className="select" name="periodId">
            {availablePeriods(scheduling).map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
          </select>
        </label>}
        {needsConsent && <ContributionPolicyConsent />}
      </AsyncForm>
    </Modal>}
  </>;
}
