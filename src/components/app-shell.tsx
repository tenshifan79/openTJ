"use client";

import {
  BookOpen,
  ChevronDown,
  FileClock,
  GraduationCap,
  LogOut,
  Menu,
  Scale,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { api } from "@/lib/client/api";
import { useAppData } from "@/lib/client/store";

const searchSections: Record<string, { path: string; label: string }> = {
  ASSESSMENT: { path: "assessments", label: "Assessment" },
  NOTE: { path: "materials", label: "Material" },
  ADVICE: { path: "discussion", label: "Discussion" },
  DISCUSSION_THREAD: { path: "discussion", label: "Discussion" },
  DISCUSSION_REPLY: { path: "discussion", label: "Reply" },
  QUESTION: { path: "questions", label: "Sample question" },
};

type SearchHit = { id: string; title?: string; prompt?: string; contentKind: string; assessmentId?: string; href?: string };
type SearchResponse = { key: string; items: { id: string; title: string; label: string; href: string }[]; error?: string };

function searchItem(hit: SearchHit, coursePath: string) {
  const section = searchSections[hit.contentKind];
  if (!section) return [];
  const hasCourseHref = hit.href?.startsWith(`${coursePath}/`) && !hit.href.includes("\\");
  const filter = hit.contentKind === "QUESTION" && hit.assessmentId ? `?assessment=${encodeURIComponent(hit.assessmentId)}` : "";
  return [{
    id: hit.id,
    title: hit.title ?? hit.prompt ?? section.label,
    label: section.label,
    href: hasCourseHref && hit.href ? hit.href : `${coursePath}/${section.path}${filter}#${encodeURIComponent(hit.id)}`,
  }];
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResponse, setSearchResponse] = useState<SearchResponse>();
  const [logoutError, setLogoutError] = useState("");
  const { user, data, courses, slug, isAdmin, canModerate } = useAppData();
  const canSearch = Boolean(data && data.course.slug === slug);
  const courseHome = canSearch ? slug : courses.find(course => course.joined)?.slug;
  const role = isAdmin ? "Administrator"
    : canModerate ? "Course staff"
    : user?.isTeacher ? "School staff"
    : user?.isStudent ? "Student" : "Member";
  const searchText = query.trim();
  const searchKey = `${slug}:${searchText}`;
  const shownSearch = searchResponse?.key === searchKey ? searchResponse : undefined;
  const showResults = searchOpen && canSearch && searchText.length >= 2;
  const headerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const searchResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close transient navigation UI after an external pathname change.
    setDrawerOpen(false);
    setProfileOpen(false);
    setMobileSearchOpen(false);
    setSearchOpen(false);
    setSearchResponse(undefined);
    setQuery("");
  }, [pathname]);

  useEffect(() => {
    if (!canSearch || searchText.length < 2) return;
    const controller = new AbortController();
    const coursePath = `/courses/${encodeURIComponent(slug)}`;
    const timer = window.setTimeout(async () => {
      try {
        const response = await api<{ results: SearchHit[] }>(`${coursePath}/search?q=${encodeURIComponent(searchText)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setSearchResponse({ key: searchKey, items: response.results.flatMap(item => searchItem(item, coursePath)) });
      } catch (reason) {
        if (!controller.signal.aborted) setSearchResponse({ key: searchKey, items: [], error: reason instanceof Error ? reason.message : "Search failed." });
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [canSearch, searchKey, searchText, slug]);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && headerRef.current?.contains(event.target)) return;
      setProfileOpen(false);
      setSearchOpen(false);
      setMobileSearchOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);

  const navItems = [
    { href: "/courses", label: "Courses", icon: GraduationCap, show: true },
    { href: "/me/practice", label: "My practice", icon: FileClock, show: true },
    { href: "/policy", label: "Policy", icon: Scale, show: true },
    { href: "/moderation", label: "Moderation", icon: ShieldCheck, show: canModerate },
    { href: "/admin", label: "Admin", icon: SlidersHorizontal, show: isAdmin },
  ];

  async function logout() {
    setLogoutError("");
    try {
      await api("/auth/logout", { method: "POST", body: {} });
      router.push("/login");
      router.refresh();
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : "Unable to sign out.");
    }
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="app-header" ref={headerRef} onKeyDown={event => {
        if (event.key !== "Escape") return;
        if (profileOpen) profileButtonRef.current?.focus();
        if (mobileSearchOpen) mobileSearchButtonRef.current?.focus();
        else if (searchOpen) searchRef.current?.focus();
        setDrawerOpen(false);
        setProfileOpen(false);
        setSearchOpen(false);
        setMobileSearchOpen(false);
      }}>
        <button aria-expanded={drawerOpen} aria-label={drawerOpen ? "Close navigation" : "Open navigation"} className="header-button menu-button" onClick={() => setDrawerOpen((value) => !value)} type="button">
          {drawerOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <Link className="brand header-brand" href="/courses">
          <BrandMark />
          <span className="brand-name">openTJ</span>
        </Link>
        <div id="header-search" className={`header-search${mobileSearchOpen ? " mobile-open" : ""}`}>
          {canSearch ? <>
            <form role="search" className="header-search-field" onSubmit={event => {
              event.preventDefault(); setSearchOpen(true);
              searchResultsRef.current?.querySelector("a")?.focus();
            }}>
              <input
                aria-label="Search current course"
                autoComplete="off"
                onChange={(event) => {
                  const next = event.target.value;
                  if (next.trim() !== searchText) setSearchResponse(undefined);
                  setQuery(next); setSearchOpen(true);
                }}
                onFocus={() => { setSearchOpen(true); setProfileOpen(false); }}
                onKeyDown={event => {
                  if (event.key !== "ArrowDown") return;
                  const firstResult = searchResultsRef.current?.querySelector("a");
                  if (firstResult) { event.preventDefault(); firstResult.focus(); }
                }}
                placeholder="Search this course"
                ref={searchRef}
                maxLength={120}
                value={query}
              />
              <button aria-label="Show search results" className="header-search-button" type="submit"><Search aria-hidden="true" /></button>
            </form>
            {showResults && <div aria-label="Search results" className="search-results" ref={searchResultsRef} role="region">
              {shownSearch?.items.length ? shownSearch.items.map(item => (
                <Link className="search-result" href={item.href} key={item.id} onClick={() => { setSearchOpen(false); setMobileSearchOpen(false); }}>
                  {item.title}<small>{item.label}</small>
                </Link>
              )) : <p className="search-status" role="status">{shownSearch?.error ?? (shownSearch ? "No results." : "Searching…")}</p>}
            </div>
            }
          </> : null}
        </div>
        <div className="header-actions">
          {canSearch && <button
            aria-label="Search"
            aria-controls="header-search"
            aria-expanded={mobileSearchOpen}
            className="header-button menu-button"
            ref={mobileSearchButtonRef}
            onClick={() => {
              setProfileOpen(false);
              setMobileSearchOpen(!mobileSearchOpen);
              setSearchOpen(!mobileSearchOpen);
              if (!mobileSearchOpen) requestAnimationFrame(() => searchRef.current?.focus());
            }}
            type="button"
          >
            <Search aria-hidden="true" />
          </button>}
          <ThemeToggle />
          {user && <div className="profile-menu">
            <button aria-expanded={profileOpen} aria-label={`User menu for ${user.displayName}`} className="header-button profile-button" ref={profileButtonRef} onClick={() => {
              setProfileOpen(!profileOpen); setSearchOpen(false); setMobileSearchOpen(false);
            }} type="button">
              <span className="profile-icon"><UserRound aria-hidden="true" /></span>
              <span className="header-action-label">{user.displayName}</span>
              <ChevronDown aria-hidden="true" className="profile-caret" />
            </button>
            {profileOpen ? (
              <div className="search-results profile-dropdown">
                <div className="profile-details">
                  <strong>{user.displayName}</strong>
                  <div className="muted small">@{user.username} · {role}</div>
                </div>
                <button className="search-result profile-logout" onClick={logout} type="button"><LogOut aria-hidden="true" /> Sign out</button>
                {logoutError && <p className="search-status" role="alert">{logoutError}</p>}
              </div>
            ) : null}
          </div>}
        </div>
      </header>

      <nav aria-label="Main navigation" className={`app-rail${drawerOpen ? " open" : ""}`}>
        <ul className="rail-links">
          {navItems.filter((item) => item.show).map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href === "/courses" && pathname.startsWith("/courses/"));
            return (
              <li key={item.href}>
                <Link aria-current={active ? "page" : undefined} className={`rail-link${active ? " active" : ""}`} href={{ pathname: item.href }} onClick={() => setDrawerOpen(false)}>
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
          {courseHome && <li>
            <Link className="rail-link" href={`/courses/${encodeURIComponent(courseHome)}`} onClick={() => setDrawerOpen(false)}>
              <BookOpen aria-hidden="true" />
              <span>Course home</span>
            </Link>
          </li>}
        </ul>
      </nav>
      {drawerOpen ? <button aria-label="Close navigation" className="drawer-overlay" onClick={() => setDrawerOpen(false)} type="button" /> : null}
      <main className="app-main" id="main-content" tabIndex={-1}>
        {children}
      </main>
    </>
  );
}
