"use client";

import { api, type CoursePeriod } from "@/lib/client/api";
import { AsyncForm, Panel } from "./ui";

export function CoursePeriodEnrollment({ slug, periods, onSaved }: { slug: string; periods: CoursePeriod[]; onSaved(): Promise<void> }) {
  return <Panel title="Choose your period">
    <AsyncForm label="Save period" onSubmit={async (form) => {
      await api(`/courses/${slug}/periods`, { method: "PATCH", body: { periodId: form.get("periodId") } });
      await onSaved();
    }}>
      <label className="field"><span>Period</span>
        <select className="select" name="periodId" defaultValue={periods.length === 1 ? periods[0]?.id : ""} required>
          <option value="" disabled>Choose a period</option>
          {periods.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
        </select>
      </label>
    </AsyncForm>
  </Panel>;
}
