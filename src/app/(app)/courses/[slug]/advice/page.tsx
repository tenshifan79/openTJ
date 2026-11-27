"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppData } from "@/lib/client/store";

export default function LegacyAdvicePage() {
  const { slug } = useAppData();
  const router = useRouter();
  useEffect(() => {
    const id = window.location.hash.slice(1);
    const thread = /^[A-Za-z0-9_-]{1,150}$/.test(id) ? `/${id}` : "";
    router.replace(`/courses/${encodeURIComponent(slug)}/discussion${thread}${window.location.search}`);
  }, [router, slug]);
  return <p role="status">Opening discussion…</p>;
}
