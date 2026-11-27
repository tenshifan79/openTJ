import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/server/auth";
import { getAppUrl } from "@/lib/server/env";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser(new Request(getAppUrl(), { headers: await headers() }));
  if (!user || user.accountStatus !== "ACTIVE") redirect("/login");
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
