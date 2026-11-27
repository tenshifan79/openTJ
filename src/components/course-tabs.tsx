"use client";

import { CalendarDays, ClipboardList, FileText, MessageSquareText } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppData } from "@/lib/client/store";

const tabs = [
  { label: "Calendar", href: "calendar", icon: CalendarDays },
  { label: "Assessments", href: "assessments", icon: ClipboardList },
  { label: "Discussion", href: "discussion", icon: MessageSquareText },
  { label: "Materials", href: "materials", icon: FileText },
];

export function CourseTabs() {
  const pathname = usePathname();
  const { slug } = useAppData();
  return (
    <nav aria-label="Course sections" className="course-tabs">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const href = `/courses/${slug}/${tab.href}`;
        const legacyMaterials = [`/courses/${slug}/notes`, `/courses/${slug}/questions`];
        const active = pathname === href || pathname.startsWith(`${href}/`) || (tab.href === "materials" && legacyMaterials.includes(pathname));
        return (
          <Link aria-current={active ? "page" : undefined} className={`course-tab${active ? " active" : ""}`} href={{ pathname: href }} key={tab.href} title={tab.label}>
            <Icon aria-hidden="true" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
