"use client";

import FullCalendar from "@fullcalendar/react";
import type { EventChangeArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import timeGridPlugin from "@fullcalendar/timegrid";
import luxonPlugin from "@fullcalendar/luxon3";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import { ContentEditor } from "@/components/content-editor";
import { CourseTabs } from "@/components/course-tabs";
import { ContributionMeta } from "@/components/contribution-meta";
import { PageHeading } from "@/components/page-heading";
import { AsyncForm, Badge, Modal, Panel } from "@/components/ui";
import { dateLabel, scheduleStatus, visible, type CalendarEvent } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";

type PendingMove = { change: Pick<EventChangeArg, "event" | "revert">; original: CalendarEvent };
const emptyEvents: CalendarEvent[] = [];

function displayEnd(event: CalendarEvent) {
  if (!event.end) return null;
  const end = event.allDay ? DateTime.fromISO(event.end, { zone: "utc" }).minus({ days: 1 }).toISODate() : event.end;
  return end !== event.start ? end : null;
}

export default function CalendarPage() {
  const { data, user, slug, mutate } = useAppData();
  const [initial, setInitial] = useState<Record<string, unknown> | null>(null);
  const [update, setUpdate] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [scope, setScope] = useState("all");
  const [move, setMove] = useState<PendingMove | null>(null);
  const [remove, setRemove] = useState<CalendarEvent | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState("");
  const calendar = useRef<FullCalendar>(null);
  const events = data?.events ?? emptyEvents;
  const isStaff = data?.permissions.canModerate ?? false;
  const periods = data?.periods ?? [];
  const displayedEvents = !isStaff || scope === "all" ? events : events.filter((item) => (item.periodId ?? "") === scope);
  const selected = displayedEvents.find((item) => item.id === selectedId) ?? displayedEvents.find(visible);
  const selectedEnd = selected ? displayEnd(selected) : null;
  const periodName = (id: string | null) => periods.find((period) => period.id === id)?.label ?? "All periods";
  const authorChanges = (item: CalendarEvent) => item.periodId === (data?.periodId ?? null) && item.visibility !== "HIDDEN_BY_MODERATOR";
  const canChange = (item: CalendarEvent) => isStaff || (authorChanges(item) && item.authorId === user?.id && !item.locked);
  const initialScope = isStaff && scope !== "all" ? { periodId: scope || null } : {};

  useEffect(() => {
    const query = window.matchMedia("(max-width: 600px)");
    const resize = () => calendar.current?.getApi().changeView(query.matches ? "listMonth" : "dayGridMonth");
    resize(); query.addEventListener("change", resize);
    return () => query.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    const selectLinked = () => {
      const item = events.find(event => event.id === window.location.hash.slice(1));
      if (item) {
        setSelectedId(item.id);
        setScope((current) => current === "all" || current === (item.periodId ?? "") ? current : "all");
        calendar.current?.getApi().gotoDate(item.start);
      }
    };
    queueMicrotask(selectLinked);
    window.addEventListener("hashchange", selectLinked);
    return () => window.removeEventListener("hashchange", selectLinked);
  }, [events]);
  const changeEvent = (change: Pick<EventChangeArg, "event" | "revert">) => {
    const original = events.find(item => item.id === change.event.id);
    if (!original || !canChange(original)) { change.revert(); return; }
    setSelectedId(original.id); setMove({ change, original });
  };
  const cancelMove = () => { move?.change.revert(); setMove(null); };

  return <>
    <PageHeading course title="Calendar" action={<button className="button button-primary" onClick={() => setInitial(initialScope)} type="button">Add event</button>} />
    <CourseTabs />
    {isStaff && periods.length > 0 && <label className="field filter-field"><span>Show events for</span>
      <select className="select" value={scope} onChange={(event) => { setScope(event.target.value); setSelectedId(""); }}>
        <option value="all">All schedules</option>
        <option value="">Course-wide</option>
        {periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
      </select>
    </label>}
    {actionError && <p className="notice notice-warning" role="alert">{actionError}</p>}
    <div className="calendar-layout">
      <Panel className="calendar-panel"><div className="calendar-wrap">
        <FullCalendar ref={calendar} plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin]}
          initialView="dayGridMonth" headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listMonth" }}
          buttonIcons={false} buttonText={{ prev: "Previous", next: "Next", month: "Month", week: "Week", day: "Day", list: "Agenda" }} timeZone="America/New_York" dayMaxEvents height="auto"
          eventDrop={changeEvent} eventResize={changeEvent} editable={!move}
          dateClick={({ dateStr, allDay }) => setInitial({ ...initialScope, start: dateStr, allDay })}
          eventClick={({ event }) => setSelectedId(event.id)}
          events={displayedEvents.filter(visible).map(item => ({ id: item.id, title: isStaff && scope === "all" && periods.length ? `${item.title} · ${periodName(item.periodId)}` : item.title, start: item.start, end: item.end ?? undefined, allDay: item.allDay, editable: canChange(item), classNames: [`event-${item.kind}`] }))} />
      </div></Panel>
      <aside className="stack" aria-label="Selected calendar item">
        <Panel title="Event details">{selected ? <div className="stack" id={selected.id}>
          <div className="split wrap"><h3>{selected.title}</h3><Badge>{selected.kind}</Badge></div>
          <p>{dateLabel(selected.start)}{selectedEnd ? ` to ${dateLabel(selectedEnd)}` : ""}{selected.allDay ? " · All day" : " ET"}</p>
          <div className="split wrap">
            {periods.length > 0 && <Badge>{periodName(selected.periodId)}</Badge>}
            <Badge tone={selected.confirmedAt ? "success" : undefined}>{scheduleStatus(selected)}</Badge>
          </div>
          {selected.details && <p className="plain-content">{selected.details}</p>}
          <ContributionMeta allowAuthorChanges={authorChanges(selected)} item={selected} kind="CALENDAR_EVENT" />
          {canChange(selected) && <div className="split wrap">
            {isStaff && visible(selected) && !selected.confirmedAt && <button className="button" disabled={confirming} type="button" onClick={async () => {
              setConfirming(true);
              setActionError("");
              try { await mutate(`/courses/${slug}/calendar/${selected.id}`, { action: "confirm", version: selected.version }, "PATCH"); }
              catch (reason) { setActionError(reason instanceof Error ? reason.message : "Unable to confirm this date."); }
              finally { setConfirming(false); }
            }}>Confirm date</button>}
            <button className="button" type="button" onClick={() => setRemove(selected)}>Remove from calendar</button>
          </div>}
          <hr /><h3>Updates</h3>
          {selected.updates.map(item => <article className="nested-card" id={item.id} key={item.id}><p className="plain-content">{item.body}</p><ContributionMeta eventId={selected.id} item={item} kind="CALENDAR_UPDATE" /></article>)}
          {!selected.updates.length && <p className="empty-state">No updates yet.</p>}
          {visible(selected) && <button className="button" type="button" disabled={selected.locked && !isStaff} onClick={() => setUpdate(true)}>Add update</button>}
        </div> : <p className="empty-state">Select an event or add one to get started.</p>}</Panel>
        {displayedEvents.some(item => !visible(item)) && <Panel title="Hidden events"><ul className="item-list">{displayedEvents.filter(item => !visible(item)).map(item => <li key={item.id}><button className="link-button" onClick={() => setSelectedId(item.id)} type="button">{item.title}</button></li>)}</ul></Panel>}
      </aside>
    </div>
    {initial && <ContentEditor initial={initial} kind="CALENDAR_EVENT" onClose={() => setInitial(null)} />}
    {update && selected && <ContentEditor eventId={selected.id} kind="CALENDAR_UPDATE" onClose={() => setUpdate(false)} />}
    {move && <Modal open title="Confirm calendar change" onClose={cancelMove}>
      <AsyncForm label="Save new time" onCancel={cancelMove} onSubmit={async () => {
        const changed = move.change.event;
        await mutate(`/courses/${slug}/content/${move.original.id}`, { version: move.original.version, start: changed.startStr, end: changed.endStr || null, allDay: changed.allDay }, "PATCH");
        setMove(null);
      }}>
        <p>Move <strong>{move.original.title}</strong> from {dateLabel(move.original.start)} to {dateLabel(move.change.event.startStr)}?</p>
        {periods.length > 0 && <p>{periodName(move.original.periodId)}</p>}
      </AsyncForm>
    </Modal>}
    {remove && <Modal open title="Remove from calendar" onClose={() => setRemove(null)}>
      <AsyncForm label="Remove event" onCancel={() => setRemove(null)} onSubmit={async () => {
        await mutate(`/courses/${slug}/calendar/${remove.id}`, { action: "remove", version: remove.version }, "PATCH");
        setRemove(null);
      }}>
        <p>{remove.title} · {periodName(remove.periodId)}</p>
      </AsyncForm>
    </Modal>}
  </>;
}
