import { describe, expect, it } from "vitest";
import { googleMaterialLink } from "@/lib/materials";
import { noteSchema } from "@/lib/server/content";

describe("Google material links", () => {
  it.each([
    ["https://drive.google.com/open?id=abc_123&resourcekey=0-test&usp=sharing", "https://drive.google.com/file/d/abc_123/view?resourcekey=0-test", "https://drive.google.com/file/d/abc_123/preview?resourcekey=0-test"],
    ["https://docs.google.com/document/d/abc/edit?usp=sharing", "https://docs.google.com/document/d/abc/edit", "https://docs.google.com/document/d/abc/preview"],
    ["https://docs.google.com/document/u/1/d/abc/edit", "https://docs.google.com/document/d/abc/edit", "https://docs.google.com/document/d/abc/preview"],
    ["https://docs.google.com/presentation/d/e/public_slides/embed", "https://docs.google.com/presentation/d/e/public_slides/pub", "https://docs.google.com/presentation/d/e/public_slides/embed"],
  ])("normalizes a supported URL", (url, view, preview) => {
    expect(googleMaterialLink(url)).toEqual({ view, preview });
  });

  it.each([
    "http://drive.google.com/file/d/abc/view",
    "https://drive.google.com.example.org/file/d/abc/view",
    "https://some-user@drive.google.com/file/d/abc/view",
    "https://drive.google.com:8443/file/d/abc/view",
    "https://drive.google.com/drive/folders/abc",
    "https://docs.google.com/presentation/d/abc/unknown",
    "https://drive.google.com/open?id=abc%2Fpreview",
  ])("rejects an unsupported URL", (url) => {
    expect(googleMaterialLink(url)).toBeNull();
  });

  it("accepts one material format and defaults older text writes to Notes", () => {
    expect(noteSchema.parse({ title: "Notes", mode: "Plain text", body: "Text" }).tag).toBe("NOTES");
    expect(noteSchema.safeParse({ title: "Mixed", mode: "Google link", googleUrl: "https://drive.google.com/file/d/abc/view", body: "Text" }).success).toBe(false);
  });
});
