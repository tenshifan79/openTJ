import { randomUUID } from "node:crypto";
import { expect, test as base, type BrowserContext, type Page } from "@playwright/test";

type Persona = "student-member" | "course-staff" | "platform-admin";
type RecordMeta = { id: string; version: number; visibility: string; authorId: string };
type Snapshot = { user: { id: string }; notes: RecordMeta[]; advice: RecordMeta[]; questions: RecordMeta[]; events: RecordMeta[]; assessments: RecordMeta[] };
type Workspace = { slug: string; name: string; path: string; login(persona: Persona): Promise<void>; post<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> };

// Each test owns a separate course and a separate Playwright browser context. Persona
// changes therefore cannot replace another parallel test's session cookie. Cleanup
// hides only this test's contributions and archives only this test's course; it never
// clears the shared development student's unrelated practice history.
const test = base.extend<{ workspace: Workspace }>({
  workspace: async ({ page, baseURL }, runFixture, testInfo) => {
    if (!baseURL) throw new Error("A Playwright baseURL is required.");
    const origin = new URL(baseURL).origin;
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const slug = `e2e-${testInfo.project.name}-${suffix}`;
    const name = `Browser workflow ${suffix}`;
    const post = async <T,>(path: string, body: unknown): Promise<T> => {
      let response = await page.context().request.post(`/api/v1${path}`, { headers: { Origin: origin }, data: body });
      // Concurrent browser suites share the local server's login limit. Respect a
      // real 429 once, rather than weakening the server or manufacturing an IP.
      if (response.status() === 429) {
        const seconds = Math.min(Number(response.headers()["retry-after"]) || 60, 60);
        await new Promise(resolve => setTimeout(resolve, seconds * 1000));
        response = await page.context().request.post(`/api/v1${path}`, { headers: { Origin: origin }, data: body });
      }
      expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
      return (await response.json()).data as T;
    };
    const sessions = new Map<Persona, Awaited<ReturnType<BrowserContext["cookies"]>>>();
    const login = async (persona: Persona) => {
      const saved = sessions.get(persona);
      await page.context().clearCookies();
      if (saved) await page.context().addCookies(saved);
      else {
        await post("/auth/dev-login", { persona });
        sessions.set(persona, await page.context().cookies());
      }
    };
    await login("platform-admin");
    const course = await post<{ id: string }>("/admin", { action: "createCourse", name, slug, description: "Isolated automated browser verification." });
    try {
      await post(`/courses/${slug}/members`, { username: "demo.student", role: "MEMBER" });
      await post(`/courses/${slug}/members`, { username: "demo.teacher", role: "STAFF" });
      await login("student-member");
      await post("/policy/accept", {});
      await runFixture({ slug, name, path: `/courses/${slug}`, login, post });
    } finally {
      try {
        await login("student-member");
        const response = await page.context().request.get(`/api/v1/courses/${slug}`);
        if (response.ok()) {
          const snapshot = (await response.json()).data as Snapshot;
          for (const item of [...snapshot.questions, ...snapshot.notes, ...snapshot.advice, ...snapshot.events, ...snapshot.assessments]) {
            if (item.authorId === snapshot.user.id && item.visibility === "PUBLISHED") {
              await post(`/courses/${slug}/content/${item.id}/visibility`, { version: item.version, action: "hide" });
            }
          }
        }
      } finally {
        await login("platform-admin");
        await post("/admin", { action: "course", courseId: course.id, archived: true });
      }
    }
  },
});

test.describe.configure({ timeout: 180_000 });

async function submitDialog(page: Page, label = "Publish") {
  await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 20_000 });
}

test("persists notes and checks all question types by keyboard", async ({ page, workspace }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  const plainTitle = `Plain note ${workspace.slug}`;
  const mathTitle = `Mathematical note ${workspace.slug}`;
  const assessmentTitle = `Original practice ${workspace.slug}`;

  await test.step("plain notes survive reload and math notes render KaTeX", async () => {
    await page.goto(`${workspace.path}/materials`);
    await page.getByRole("button", { name: "Add material", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Title", { exact: true }).fill(plainTitle);
    await page.getByRole("dialog").locator("textarea[name=body]").fill(`Plain content ${workspace.slug}`);
    await submitDialog(page);
    await page.reload();
    await expect(page.getByText(`Plain content ${workspace.slug}`, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add material", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Title", { exact: true }).fill(mathTitle);
    await page.getByRole("dialog").getByLabel("Format").selectOption("Markdown + LaTeX");
    await page.getByRole("dialog").locator("textarea[name=body]").fill("A formula: $x^2 + y^2 = z^2$.");
    await submitDialog(page);
    await expect(page.locator("article").filter({ hasText: mathTitle }).locator(".katex")).toHaveCount(1);
  });

  await test.step("an unscheduled major assessment creates a question bank", async () => {
    await page.goto(`${workspace.path}/assessments`);
    await page.getByRole("button", { name: "Add assessment", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Title", { exact: true }).fill(assessmentTitle);
    await page.getByRole("dialog").getByLabel("Summary", { exact: true }).fill("Skills for original practice.");
    await page.getByRole("dialog").getByLabel("Major assessment with a question bank").check();
    await submitDialog(page);
    await expect(page.getByRole("heading", { name: `${assessmentTitle} Test` })).toBeVisible();
    await expect(page.getByText("No date scheduled.", { exact: true })).toBeVisible();
    await page.goto(`${workspace.path}/questions`);
    await expect(page.getByRole("heading", { name: `${assessmentTitle} question bank` })).toBeVisible();
  });

  for (const type of ["SINGLE_CHOICE", "SHORT_ANSWER", "LONG_RESPONSE"] as const) {
    await test.step(`author and answer ${type}`, async () => {
      await page.getByRole("button", { name: "Add question", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator("select").nth(1).selectOption(type);
      await dialog.locator("textarea[name=prompt]").fill(`${type} original prompt ${workspace.slug}`);
      await dialog.locator("input[name=skills]").fill(type);
      if (type === "SINGLE_CHOICE") {
        await dialog.locator("textarea[name=choices]").fill("One\nTwo\nThree");
        await dialog.locator("input[name=correctChoice]").fill("2");
        await dialog.locator("textarea[name=explanations]").fill("First wrong\nSecond correct\nThird wrong");
      } else if (type === "SHORT_ANSWER") {
        await dialog.locator("select").nth(2).selectOption("NUMERIC");
        await dialog.locator("input[name=numericAnswer]").fill("42");
      }
      await dialog.locator("textarea[name=solution]").fill(`Detailed reasoning ${workspace.slug}`);
      await dialog.getByRole("checkbox").check();
      await submitDialog(page);
      await page.getByRole("navigation", { name: "Questions", exact: true }).getByRole("button").filter({ hasText: type }).click();
      await expect(page.getByText(`Detailed reasoning ${workspace.slug}`, { exact: true })).toBeHidden();
      if (type === "SINGLE_CHOICE") {
        await page.getByRole("radio").nth(1).check();
        await page.getByRole("radio").nth(1).press("Enter");
        await expect(page.getByText("Correct", { exact: true })).toBeVisible();
        await expect(page.getByText("Second correct", { exact: true })).toBeVisible();
      } else if (type === "SHORT_ANSWER") {
        await page.getByLabel("Your answer", { exact: true }).fill("42");
        await page.getByLabel("Your answer", { exact: true }).press("Enter");
        await expect(page.getByText("Correct", { exact: true })).toBeVisible();
      } else {
        await page.locator(".question-stage textarea").fill(`My reasoning ${workspace.slug}`);
        await page.locator(".question-stage textarea").press("Control+Enter");
        await expect(page.getByText("Detailed solution / rubric", { exact: true })).toBeVisible();
        await expect(page.getByText(`Detailed reasoning ${workspace.slug}`, { exact: true })).toBeVisible();
      }
    });
  }

  await page.goto("/me/practice");
  await expect(page.getByText(`My reasoning ${workspace.slug}`, { exact: false })).toBeVisible();
  await workspace.login("platform-admin");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform accounts", exact: true })).toBeVisible();
  await page.goto("/moderation");
  await expect(page.getByRole("heading", { name: "Recent audit history", exact: true })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("keeps a material draft through policy acceptance and opens a Google preview on request", async ({ page, workspace }) => {
  const title = `Practice Slides ${workspace.slug}`;
  await page.route("**/api/v1/auth/session", async route => {
    const response = await route.fetch();
    const session = await response.json();
    await route.fulfill({ response, json: { ...session, data: { ...session.data, policyAccepted: false } } });
  }, { times: 1 });
  await page.route("https://docs.google.com/presentation/d/test_slides/preview", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<!doctype html><p>Request access</p>",
  }));

  await page.goto(`${workspace.path}/materials`);
  await page.getByRole("button", { name: "Add material", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Tag").selectOption("PRACTICE_ASSESSMENT");
  await dialog.getByLabel("Format").selectOption("Google link");
  await dialog.getByLabel("Google Drive, Docs, or Slides link").fill("https://docs.google.com/presentation/d/test_slides/edit?usp=sharing");
  const popup = page.waitForEvent("popup");
  await dialog.getByRole("link", { name: /read the contribution policy/i }).click();
  const policy = await popup;
  await expect(policy.getByRole("heading", { name: "Contribution policy", exact: true })).toBeVisible();
  await policy.close();
  await expect(dialog.getByLabel("Title", { exact: true })).toHaveValue(title);
  await dialog.getByRole("checkbox", { name: /accept the contribution policy/i }).check();
  await submitDialog(page);

  await page.getByRole("combobox", { name: "Tag", exact: true }).selectOption("PRACTICE_ASSESSMENT");
  const card = page.locator("article").filter({ hasText: title });
  await expect(card.getByRole("link", { name: "Open in Google" })).toHaveAttribute("href", "https://docs.google.com/presentation/d/test_slides/edit");
  const preview = card.locator("iframe");
  await expect(preview).toHaveCount(0);
  await card.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(preview).toHaveAttribute("src", "https://docs.google.com/presentation/d/test_slides/preview");
  await expect(card.frameLocator("iframe").getByText("Request access")).toBeVisible();
  await expect(card.getByRole("link", { name: "Open in Google" })).toBeVisible();
});

test("edits, reports, appeals, restores, and follows a search result", async ({ page, workspace }) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  const note = await workspace.post<{ id: string }>(`/courses/${workspace.slug}/content`, { kind: "NOTE", mode: "Plain text", title: `Review ${workspace.slug}`, body: "Original body" });
  await page.goto(`${workspace.path}/notes`);
  const card = page.locator(`article[id="${note.id}"]`);

  await test.step("attributed editing, author hiding, restoration, and reporting", async () => {
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("dialog").locator("textarea[name=body]").fill(`Edited body ${workspace.slug}`);
    await submitDialog(page, "Save changes");
    await expect(card.getByText(`Edited body ${workspace.slug}`, { exact: true })).toBeVisible();
    await expect(card.getByText(/Demo Student \(@demo\.student\)/)).toBeVisible();
    await card.getByRole("button", { name: "Hide", exact: true }).click();
    await submitDialog(page, "Confirm");
    await card.getByRole("button", { name: "Restore", exact: true }).click();
    await submitDialog(page, "Confirm");
    await card.getByRole("button", { name: "Report", exact: true }).click();
    await page.getByRole("dialog").locator("select[name=reason]").selectOption("OTHER");
    await page.getByRole("dialog").locator("textarea").fill(`Report ${workspace.slug}`);
    await submitDialog(page, "Submit report");
  });

  await test.step("administrator takedown and author appeal", async () => {
    await workspace.login("platform-admin");
    await page.goto("/moderation");
    await page.locator("article").filter({ hasText: `Review ${workspace.slug}` }).getByRole("button", { name: "Review report", exact: true }).click();
    await page.getByRole("dialog").locator("textarea").fill(`Takedown ${workspace.slug}`);
    await submitDialog(page, "Apply decision");
    await workspace.login("student-member");
    await page.goto(`${workspace.path}/notes`);
    await card.getByRole("button", { name: "Appeal takedown", exact: true }).click();
    await page.getByRole("dialog").locator("textarea").fill(`Appeal ${workspace.slug}`);
    await submitDialog(page, "Submit appeal");
  });

  await test.step("assigned staff overturn the takedown", async () => {
    await workspace.login("course-staff");
    await page.goto("/moderation");
    await page.locator("article").filter({ hasText: `Appeal ${workspace.slug}` }).getByRole("button", { name: "Resolve appeal", exact: true }).click();
    await page.getByRole("dialog").locator("select").selectOption("OVERTURNED");
    await page.getByRole("dialog").locator("textarea").fill(`Resolution ${workspace.slug}`);
    await submitDialog(page, "Resolve appeal");
    await workspace.login("student-member");
    await page.goto(`${workspace.path}/notes`);
    await expect(card.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  });

  await test.step("search navigates to the contribution fragment", async () => {
    const search = page.getByLabel("Search current course");
    if (!(await search.isVisible())) await page.getByRole("button", { name: "Search", exact: true }).click();
    await search.fill(`Review ${workspace.slug}`);
    const result = page.getByRole("region", { name: "Search results" }).getByRole("link").first();
    await expect(result).toHaveAttribute("href", `${workspace.path}/materials#${note.id}`);
    await result.click();
    await expect(page).toHaveURL(new RegExp(`/materials#${note.id}$`));
    await expect(card).toBeVisible();
  });
  expect(runtimeErrors).toEqual([]);
});

test("keeps a discussion draft and supports replies, reactions, search, and staff actions", async ({ page, workspace }) => {
  const title = "Why does this factoring step work?";
  const postBody = "Can someone explain why the common factor can be taken out?";
  const answerBody = "The distributive property gives the original expression when you multiply back.";
  const discussion = `${workspace.path}/discussion`;

  // Exercise the first-post interface without changing acceptance for other tests
  // that use the same development persona.
  const sessionRoute = "**/api/v1/auth/session";
  await page.route(sessionRoute, async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    payload.data.policyAccepted = false;
    await route.fulfill({ response, json: payload });
  });
  await page.goto(discussion);
  await page.getByRole("button", { name: "New thread", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Title").fill(title);
  await editor.getByLabel("Post", { exact: true }).fill(postBody);
  const [policy] = await Promise.all([
    page.context().waitForEvent("page"),
    editor.getByRole("link", { name: /Read the contribution policy/ }).click(),
  ]);
  await expect(policy.getByRole("heading", { name: "Contribution policy", exact: true })).toBeVisible();
  await policy.close();
  await expect(editor.getByLabel("Post", { exact: true })).toHaveValue(postBody);
  await editor.getByLabel("I accept the contribution policy.").check();
  await page.unroute(sessionRoute);
  await submitDialog(page, "Post thread");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  const threadUrl = page.url();

  await page.goto(discussion);
  await page.getByRole("button", { name: "Unanswered", exact: true }).click();
  await page.getByRole("link", { name: title, exact: true }).click();
  const thread = page.locator("article").filter({ hasText: postBody });
  const wondering = thread.getByRole("button", { name: /I’m wondering this too/ });
  await wondering.click();
  await expect(wondering).toHaveAttribute("aria-pressed", "true");
  const agree = thread.getByRole("button", { name: /I agree/ });
  await agree.click();
  await expect(wondering).toHaveAttribute("aria-pressed", "false");
  await expect(agree).toHaveAttribute("aria-pressed", "true");
  await agree.click();
  await expect(agree).toHaveAttribute("aria-pressed", "false");

  await thread.getByRole("button", { name: "Reply", exact: true }).click();
  await editor.getByLabel("Reply", { exact: true }).fill(answerBody);
  await submitDialog(page, "Post reply");
  const answer = page.locator("article").filter({ hasText: answerBody });
  await expect(answer).toBeVisible();
  const answerId = await answer.getAttribute("id");
  await answer.getByRole("button", { name: "Reply", exact: true }).click();
  await editor.getByLabel("Reply", { exact: true }).fill("Multiplying back helped me see the connection.");
  await submitDialog(page, "Post reply");
  await expect(page.getByText(/In reply to/)).toBeVisible();
  const nestedId = await page.locator("article").filter({ hasText: "Multiplying back helped me see the connection." }).getAttribute("id");
  const paged = await page.request.get(`/api/v1${new URL(threadUrl).pathname}?limit=1&target=${nestedId}`);
  expect(paged.ok()).toBeTruthy();
  const { data: replyPage } = await paged.json();
  expect(replyPage.replies.map((reply: { id: string }) => reply.id)).toEqual([answerId]);
  expect(replyPage.nextCursor).toBe(answerId);
  expect(replyPage.linkedReply.id).toBe(nestedId);

  await page.goto(discussion);
  await page.getByRole("button", { name: "Unanswered", exact: true }).click();
  await expect(page.getByText("No unanswered questions.")).toBeVisible();
  const search = page.getByLabel("Search current course");
  if (!(await search.isVisible())) await page.getByRole("button", { name: "Search", exact: true }).click();
  await search.fill("distributive property");
  const result = page.getByRole("region", { name: "Search results" }).getByRole("link").first();
  await expect(result).toHaveAttribute("href", `${new URL(threadUrl).pathname}#${answerId}`);
  await result.click();
  await expect(answer).toBeVisible();

  await workspace.login("course-staff");
  await page.goto(threadUrl);
  await thread.getByRole("button", { name: "Pin thread", exact: true }).click();
  await expect(thread.getByText("Pinned", { exact: true })).toBeVisible();
  await answer.getByRole("button", { name: "Endorse reply", exact: true }).click();
  await expect(answer.getByText("Endorsed by staff", { exact: true })).toBeVisible();
  await thread.getByRole("button", { name: "Moderate", exact: true }).click();
  await editor.getByLabel("Action").selectOption("LOCK");
  await editor.locator("textarea").fill("The question has been answered.");
  await submitDialog(page, "Confirm");
  await expect(thread.getByRole("button", { name: "Reply", exact: true })).toBeHidden();
  await thread.getByRole("button", { name: "Moderate", exact: true }).click();
  await editor.getByLabel("Action").selectOption("UNLOCK");
  await editor.locator("textarea").fill("Reopen the discussion.");
  await submitDialog(page, "Confirm");
  await expect(thread.getByRole("button", { name: "Reply", exact: true })).toBeVisible();

  const legacy = await workspace.post<{ id: string }>(`${workspace.path}/content`, {
    kind: "ADVICE", type: "GENERAL", title: "Legacy thread", body: "Study the examples in order.",
  });
  await page.goto(`${workspace.path}/advice#${legacy.id}`);
  await expect(page).toHaveURL(new RegExp(`/discussion/${legacy.id}$`));
  await expect(page.getByRole("heading", { name: "Legacy thread", exact: true })).toBeVisible();
});
