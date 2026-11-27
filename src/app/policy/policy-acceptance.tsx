"use client";

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/client/api";

export function PolicyAcceptance({ signedIn, accepted }: { signedIn: boolean; accepted: boolean }) {
  const [checked, setChecked] = useState(false);
  const [done, setDone] = useState(accepted);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  if (!signedIn) return <div className="policy-action"><Link className="button button-primary" href="/login?returnTo=%2Fpolicy">Sign in to accept the policy</Link></div>;
  if (done) return <p className="policy-action policy-accepted" role="status">Policy accepted.</p>;
  return <form className="policy-action stack" onSubmit={async (event) => {
    event.preventDefault();
    if (!checked || pending) return;
    setPending(true); setError("");
    try { await api("/policy/accept", { body: {} }); setDone(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save acceptance."); }
    finally { setPending(false); }
  }}>
    <label className="check-row"><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} required /> I agree to follow this policy.</label>
    <div><button className="button button-primary" disabled={!checked || pending} type="submit">{pending ? "Saving…" : "Accept policy"}</button></div>
    {error && <p className="notice notice-danger" role="alert">{error}</p>}
  </form>;
}
