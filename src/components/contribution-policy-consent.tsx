"use client";

import { useAppData } from "@/lib/client/store";

const consentField = "contributionPolicyConsent";

export function ContributionPolicyConsent() {
  return <div className="policy-consent">
    <label className="check-row"><input name={consentField} required type="checkbox" /> I accept the contribution policy.</label>
    <a href="/policy" rel="noopener" target="_blank">Read the contribution policy (opens in a new tab)</a>
  </div>;
}

export function useContributionPolicy() {
  const { user, acceptContributionPolicy } = useAppData();
  const needsConsent = Boolean(user && !user.policyAccepted);

  async function acceptPolicy(form: FormData) {
    if (!needsConsent) return;
    if (!form.has(consentField)) throw new Error("Accept the contribution policy to continue.");
    await acceptContributionPolicy();
  }

  return { needsConsent, acceptPolicy };
}
