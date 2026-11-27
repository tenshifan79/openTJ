import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { ApiDataProvider } from "@/lib/client/store";

export function AuthenticatedShell({ children }: { children: ReactNode }) {
  return <ApiDataProvider><AppShell><div className="page-container">{children}</div></AppShell></ApiDataProvider>;
}
