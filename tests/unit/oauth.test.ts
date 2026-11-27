import { describe, expect, it } from "vitest";
import { ionProfileSchema, sanitizeReturnTo } from "@/lib/server/oauth";

describe("Ion identity roles", () => {
  it.each([
    [{ ion_username: "2030jsmith" }, true, false],
    [{ ion_username: "jsmith" }, false, false],
    [{ ion_username: "staffuser", is_teacher: true }, false, true],
    [{ ion_username: "samplecounselor", is_teacher: true, is_student: false }, false, true],
    [{ ion_username: "2030jsmith", is_student: false, is_teacher: false }, false, false],
    [{ ion_username: "2030jsmith", is_student: true, is_teacher: true }, true, false],
  ] as const)("reads roles from %j", (profile, isStudent, isTeacher) => {
    expect(ionProfileSchema.parse({ id: 42, ...profile })).toMatchObject({ isStudent, isTeacher });
  });
});

describe("OAuth return URL allowlist", () => {
  it.each(["https://evil.example", "//evil.example", "/unknown", "/courses\\evil"])("rejects %s", (value) => {
    expect(sanitizeReturnTo(value)).toBe("/courses");
  });

  it("keeps allowed local destinations", () => {
    expect(sanitizeReturnTo("/courses/concrete-math-av-p4/notes?mine=1")).toBe("/courses/concrete-math-av-p4/notes?mine=1");
  });
});
