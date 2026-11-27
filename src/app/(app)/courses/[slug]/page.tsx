"use client";

import Link from "next/link";
import { CourseTabs } from "@/components/course-tabs";
import { PageHeading } from "@/components/page-heading";
import { Panel } from "@/components/ui";
import { dateLabel, visible } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";

export default function CourseDashboardPage() {
  const { data, slug } = useAppData();
  if (!data) return null;
  const base = `/courses/${slug}`;
  const activity = data.recent ?? [];
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const upcoming = data.events.filter(visible).filter(item => item.start.slice(0, 10) >= today)
    .sort((left, right) => left.start.localeCompare(right.start)).slice(0, 6);
  return <>
    <PageHeading course title={data.course.name} />
    <CourseTabs />
    <div className="dashboard-grid">
      <div className="stack">
        <Panel title="About this course">
          {data.course.description && <p>{data.course.description}</p>}
          <span className="muted">{data.course.memberCount ?? 0} members</span>
        </Panel>
        <Panel title="Recent contributions">
          {activity.length ? <ul className="item-list">{activity.map(item => <li key={item.id}>
            <Link href={item.href}><strong>{item.title}</strong></Link>
            <div className="meta">{item.author} · {dateLabel(item.updatedAt)}</div>
          </li>)}</ul> : <p className="empty-state">No contributions yet.</p>}
        </Panel>
      </div>
      <aside className="stack">
        <Panel title="Upcoming">
          {upcoming.length ? <ul className="item-list">{upcoming.map(item => <li key={item.id}>
            <Link href={`${base}/calendar#${item.id}`}>{item.title}</Link>
            <div className="meta">{dateLabel(item.start)} · {item.confirmedAt ? "Confirmed by staff" : item.author}</div>
          </li>)}</ul> : <p className="empty-state">No upcoming events.</p>}
        </Panel>
        {!!data.banks.length && <Panel title="Practice banks"><ul className="item-list">{data.banks.map(bank => <li key={bank.id}>
          <Link href={`${base}/questions?assessment=${bank.assessmentId}`}>{bank.title ?? "Practice"}</Link>
        </li>)}</ul></Panel>}
      </aside>
    </div>
  </>;
}
