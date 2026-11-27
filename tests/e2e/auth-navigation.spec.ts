import { expect, test } from "@playwright/test";

import { openSeededCourse, signInAs } from "./helpers";

test("development persona reaches the seeded course and every course section", async ({
  page,
}) => {
  await signInAs(page, "Student member");
  await expect(
    page.getByRole("heading", { name: "Courses", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Concrete Math AV - P4", { exact: true })).toBeVisible();

  await openSeededCourse(page);

  for (const tab of [
    "Calendar",
    "Assessments",
    "Discussion",
    "Materials",
  ]) {
    const link = page.getByRole("link", { name: tab, exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator("main#main-content")).toBeVisible();
  }

  const navigation = page.getByRole("navigation", { name: "Main navigation", includeHidden: true });
  if (!(await navigation.isVisible())) await page.getByRole("button", { name: "Open navigation" }).click();
  await navigation.getByRole("link", { name: "Policy", exact: true }).click();
  await expect(page).toHaveURL(/\/policy$/);
  await expect(page.getByRole("heading", { name: "Contribution policy" })).toBeVisible();
  await expect(page.locator('nav[aria-label="Main navigation"] a[href="/policy"]')).toHaveAttribute("aria-current", "page");
});

test("production-facing login never asks for ION credentials", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("link", { name: "Sign in with ION", exact: true }).or(
      page.getByRole("button", { name: "Sign in with ION", exact: true }),
    ),
  ).toBeVisible();
  await expect(page.getByLabel(/password/i)).toHaveCount(0);
  await expect(page.getByLabel(/one.?time|otp|2fa/i)).toHaveCount(0);
  await page.getByRole("link", { name: "Contribution policy" }).click();
  await expect(page.getByRole("heading", { name: "Contribution policy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in to accept the policy" })).toHaveAttribute("href", "/login?returnTo=%2Fpolicy");
});

test("protected course pages redirect an anonymous visitor to login", async ({
  page,
}) => {
  await page.goto("/courses/concrete-math-av-p4/materials");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
});
