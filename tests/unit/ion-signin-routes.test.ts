import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests call the route handlers with real NextRequest objects, the way Next.js
// does, so they cover the hand-off between the routes and the OAuth library.
const store = vi.hoisted(() => ({ transaction: null as null | { id: string; stateHash: string }, sessions: 0 }));
vi.mock("@/lib/server/db", () => ({ db: {
  oAuthTransaction: {
    deleteMany: vi.fn(async ({ where }) => { if (where.id && store.transaction?.id === where.id) { store.transaction = null; return { count: 1 }; } return { count: 0 }; }),
    create: vi.fn(async ({ data }) => { store.transaction = { ...data, id: "transaction" }; return store.transaction; }),
    findUnique: vi.fn(async ({ where }) => store.transaction?.stateHash === where.stateHash ? store.transaction : null),
  },
  user: {
    findFirst: vi.fn(async () => null),
    create: vi.fn(async ({ data }) => ({ ...data, id: "local-user", accountStatus: "ACTIVE" })),
  },
  session: {
    create: vi.fn(async () => { store.sessions += 1; return {}; }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
} }));
import { GET as startRoute } from "@/app/api/v1/auth/ion/start/route";
import { GET as callbackRoute } from "@/app/api/v1/auth/ion/callback/route";

const origin = "https://opentj.example";
const ionProfile = { id: 123, ion_username: "student", title: null, display_name: "Fictional Student", full_name: "Fictional Student", first_name: "Fictional", last_name: "Student", is_student: true, is_teacher: false };

beforeEach(() => {
  store.transaction = null; store.sessions = 0;
  for (const [key, value] of Object.entries({ APP_URL: origin, ION_REDIRECT_URI: `${origin}/api/v1/auth/ion/callback`, ION_AUTHORIZE_URL: "https://ion.tjhsst.edu/oauth/authorize/", ION_TOKEN_URL: "https://ion.tjhsst.edu/oauth/token/", ION_PROFILE_URL: "https://ion.tjhsst.edu/api/profile", ION_CLIENT_ID: "unit-test-client", ION_CLIENT_SECRET: "unit-test-secret", ION_REVOKE_URL: "", BOOTSTRAP_ADMIN_ION_IDS: "", DATABASE_URL: "postgresql://unit.invalid/none" })) vi.stubEnv(key, value);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function cookie(response: Response, name: string): string | undefined {
  const line = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return line?.slice(name.length + 1).split(";", 1)[0];
}

/** Starts a sign-in and returns the request ION would send the browser back with. */
async function returnFromIon(returnTo: string, query: (state: string) => string) {
  const started = await startRoute(new NextRequest(`${origin}/api/v1/auth/ion/start?returnTo=${encodeURIComponent(returnTo)}`), {});
  expect(started.status).toBe(307);
  const authorize = new URL(started.headers.get("location")!);
  expect(authorize.origin + authorize.pathname).toBe("https://ion.tjhsst.edu/oauth/authorize/");
  const state = authorize.searchParams.get("state")!;
  const request = new NextRequest(`${origin}/api/v1/auth/ion/callback?${query(state)}`, { headers: { cookie: `opentj_oauth_binding=${cookie(started, "opentj_oauth_binding")}` } });
  return { request, state };
}

describe("ION sign-in routes", () => {
  it("signs the user in when ION sends the browser back with a code", async () => {
    const { request } = await returnFromIon("/courses/concrete-math-av-p4/notes", (state) => `code=test-code&state=${state}`);
    const fetchMock = vi.fn(async (url: string | URL | Request) => String(url).includes("/oauth/token/")
      ? Response.json({ access_token: "temporary-token", expires_in: 36000, token_type: "Bearer", scope: "read", refresh_token: "unused" })
      : Response.json(ionProfile));
    vi.stubGlobal("fetch", fetchMock);
    const finished = await callbackRoute(request, {});
    expect(finished.status).toBe(307);
    expect(finished.headers.get("location")).toBe(`${origin}/courses/concrete-math-av-p4/notes`);
    expect(cookie(finished, "opentj_session")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie(finished, "opentj_oauth_binding")).toBe("");
    expect(store.sessions).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns to the login page and logs the reason when ION rejects the client", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { request, state } = await returnFromIon("/courses", (value) => `code=test-code&state=${value}`);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_client" }, { status: 401 })));
    const finished = await callbackRoute(request, {});
    expect(finished.headers.get("location")).toBe(`${origin}/login?ion=failed`);
    expect(cookie(finished, "opentj_session")).toBeUndefined();
    expect(store.sessions).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ level: "warn", message: "ION sign-in failed", reason: "ION token endpoint answered 401 invalid_client" });
    expect(line).not.toContain("test-code");
    expect(line).not.toContain(state);
  });

  it("logs a declined authorization by its ION error code", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { request } = await returnFromIon("/courses", (state) => `error=access_denied&state=${state}`);
    const finished = await callbackRoute(request, {});
    expect(finished.headers.get("location")).toBe(`${origin}/login?ion=failed`);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ reason: "ION authorization answered access_denied" });
  });
});
