import { expect, test } from "@playwright/test";

import { openSeededCourse, signInAs } from "./helpers";

test("ION-familiar shell stays within the viewport", async ({ page }, testInfo) => {
  await signInAs(page, "Student member");
  await openSeededCourse(page);

  const metrics = await page.evaluate(async () => {
    const openSans = await document.fonts.load('400 13px "Open Sans"', "openTJ");
    return {
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      hasMain: Boolean(document.querySelector("main#main-content")),
      fontFamily: getComputedStyle(document.body).fontFamily,
      openSansLoaded: openSans.some(font => font.status === "loaded"),
    };
  });

  expect(metrics.hasMain).toBe(true);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.fontFamily).toMatch(/^["']?Open Sans/);
  expect(metrics.openSansLoaded).toBe(true);

  if (testInfo.project.name === "mobile-chromium") {
    await expect(
      page.getByRole("button", { name: "Open navigation", exact: true }),
    ).toBeVisible();
  }

  await testInfo.attach(`course-shell-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
