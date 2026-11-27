export const materialTags = {
  NOTES: "Notes",
  PRACTICE_ASSESSMENT: "Practice assessment",
  SAMPLE_QUESTIONS: "Sample questions",
  OTHER: "Other",
} as const;

export type MaterialTag = keyof typeof materialTags;

const googleId = /^[A-Za-z0-9_-]{1,200}$/;

export function googleMaterialLink(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;

  let base: string;
  let view: string;
  let preview: string;
  if (url.hostname === "drive.google.com") {
    const id = url.pathname === "/open"
      ? url.searchParams.get("id")
      : /^\/file\/d\/([\w-]+)(?:\/(?:view|preview|edit))?\/?$/.exec(url.pathname)?.[1];
    if (!id || !googleId.test(id)) return null;
    base = `https://drive.google.com/file/d/${id}`;
    view = `${base}/view`;
    preview = `${base}/preview`;
  } else if (url.hostname === "docs.google.com") {
    const published = /^\/(document|presentation)\/d\/e\/([\w-]+)\/(?:pub|embed)\/?$/.exec(url.pathname);
    const file = /^\/(document|presentation)(?:\/u\/\d+)?\/d\/([\w-]+)(?:\/(?:edit|view|preview|present|embed|mobilebasic))?\/?$/.exec(url.pathname);
    const match = published ?? file;
    if (!match || !googleId.test(match[2]!)) return null;
    base = `https://docs.google.com/${match[1]}/d/${published ? "e/" : ""}${match[2]}`;
    view = `${base}/${published ? "pub" : "edit"}`;
    preview = published ? `${base}/${match[1] === "presentation" ? "embed" : "pub?embedded=true"}` : `${base}/preview`;
  } else return null;

  const resourceKey = url.searchParams.get("resourcekey");
  if (resourceKey && googleId.test(resourceKey)) {
    const viewUrl = new URL(view);
    const previewUrl = new URL(preview);
    viewUrl.searchParams.set("resourcekey", resourceKey);
    previewUrl.searchParams.set("resourcekey", resourceKey);
    return { view: viewUrl.href, preview: previewUrl.href };
  }
  return { view, preview };
}
