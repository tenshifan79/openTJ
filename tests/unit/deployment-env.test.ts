import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const production = {
  NODE_ENV: "production" as const,
  APP_ENV: "production",
  APP_URL: "https://opentj.example.test",
  ION_REDIRECT_URI: "https://opentj.example.test/api/v1/auth/ion/callback",
  ION_CLIENT_ID: "unit-test-only",
  ION_CLIENT_SECRET: "unit-test-only",
  DATABASE_URL: "postgresql://unit:test@127.0.0.1:5432/unit",
  SESSION_SECRET: "unit-test-secret-with-more-than-thirty-two-characters",
};

function check(storage: string) {
  const env: NodeJS.ProcessEnv = { ...production, STORAGE_DRIVER: storage, PATH: process.env.PATH };
  const result = spawnSync(process.execPath, ["scripts/check-env.mjs"], { env, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("deployment environment check", () => {
  it("accepts a production host that turns PDF uploads off", () => {
    expect(check("disabled").status).toBe(0);
  });
  it("still requires S3 settings when storage is enabled", () => {
    const result = check("s3");
    expect(result.status).toBe(1);
    expect(result.output).toContain("S3_BUCKET is required");
  });
  it("rejects local file storage and unknown drivers in production", () => {
    expect(check("local").output).toContain("STORAGE_DRIVER=disabled");
    expect(check("none").output).toContain("STORAGE_DRIVER must be");
  });
});
