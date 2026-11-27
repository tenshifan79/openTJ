import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { LoginActions } from "@/components/login-actions";
import { isDemoAuthEnabled } from "@/lib/server/env";
import { sanitizeReturnTo } from "@/lib/server/oauth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ ion?: string; returnTo?: string | string[] }> }) {
  const { ion, returnTo } = await searchParams;
  const destination = sanitizeReturnTo(typeof returnTo === "string" ? returnTo : undefined);
  return (
    <div className="login-shell">
      <main className="login-main" id="main-content">
        <div className="login-brand">
          <BrandMark />
          <h1>openTJ</h1>
        </div>
        <section className="login-card" aria-label="Sign in">
          {ion ? <p className="notice notice-warning" role="status">{ion === "not-configured" ? "ION sign-in is unavailable." : "ION sign-in failed. Try again."}</p> : null}
          <LoginActions development={isDemoAuthEnabled()} returnTo={destination} />
        </section>
      </main>
      <footer className="login-footer">
        <Link href="/policy">Contribution policy</Link>
      </footer>
    </div>
  );
}
