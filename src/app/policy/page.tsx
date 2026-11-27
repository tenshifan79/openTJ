import { headers } from "next/headers";
import { AuthenticatedShell } from "@/components/authenticated-shell";
import { getCurrentUser } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { getAppUrl, POLICY_VERSION } from "@/lib/server/env";
import { PolicyAcceptance } from "./policy-acceptance";

export const metadata = { title: "Contribution policy" };

export default async function PolicyPage() {
  const user = await getCurrentUser(new Request(getAppUrl(), { headers: await headers() }));
  const signedIn = user?.accountStatus === "ACTIVE";
  const accepted = signedIn && Boolean(await db.policyAcceptance.findUnique({
    where: { userId_version: { userId: user.id, version: POLICY_VERSION } },
  }));

  const policy = <article className="policy" aria-labelledby="policy-title">
    <header className="page-header">
      <h1 className="page-title" id="policy-title">Contribution policy</h1>
      <p className="page-description">Version {POLICY_VERSION}</p>
    </header>
    <div className="panel policy-body">
      <h2>Academic integrity</h2>
      <p>Post work you created or have permission to share. Write original practice questions based on course skills.</p>
      <h3>Prohibited material</h3>
      <ul>
        <li>Active, recalled, copied, photographed or closely paraphrased assessment questions or answers.</li>
        <li>Answer keys, restricted teacher documents or another person’s work without permission.</li>
        <li>Material intended to provide an unfair advantage or facilitate plagiarism.</li>
        <li>Harassment, hate, threats, obscene content, personal information, impersonation, spam, malicious files or copyright violations.</li>
      </ul>
      <h2>Moderation and appeals</h2>
      <p>Report contributions that break this policy. Course staff moderate their courses. OpenTJ administrators moderate across the site. We record moderation actions and their reasons. Authors can appeal a takedown once and see the decision in their course notices.</p>
      <h2>Privacy</h2>
      <p>Contributions show the author’s name and username to members of their course. Your practice attempts are private. You can clear them from My practice. OpenTJ discards ION access tokens after sign-in.</p>
      <p>Google controls who can open linked files. Course access controls stored attachments.</p>
      <h2>About OpenTJ</h2>
      <p>OpenTJ is an independent course collaboration site. ION provides sign-in.</p>
      <PolicyAcceptance signedIn={signedIn} accepted={accepted} />
    </div>
  </article>;

  return signedIn ? <AuthenticatedShell>{policy}</AuthenticatedShell> : <main className="public-policy" id="main-content">{policy}</main>;
}
