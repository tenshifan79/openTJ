import { PlatformRole } from "@prisma/client";
import * as oauth from "oauth4webapi";
import { z } from "zod";
import { db } from "./db";
import { randomToken, safeEqual, sha256 } from "./crypto";
import { getAppUrl, getRequiredEnv } from "./env";
import { AppError } from "./http";
import type { PublicUser } from "./auth";

export const ionProfileSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    ion_username: z.string().min(1).max(100).optional(),
    username: z.string().min(1).max(100).optional(),
    full_name: z.string().min(1).max(200).optional(),
    display_name: z.string().min(1).max(200).optional(),
    first_name: z.string().max(100).nullish(),
    last_name: z.string().max(100).nullish(),
    is_student: z.boolean().optional(),
    is_teacher: z.boolean().optional(),
  })
  .transform((profile, context) => {
    const username = profile.ion_username ?? profile.username;
    if (!username) { context.addIssue({ code: "custom", message: "ION username is missing" }); return z.NEVER; }
    const hasRole = profile.is_student !== undefined || profile.is_teacher !== undefined;
    return {
      ...profile,
      username,
      isStudent: profile.is_student === true || (!hasRole && /^[0-9]/.test(username)),
      isTeacher: profile.is_teacher === true && profile.is_student !== true,
    };
  });

function oauthConfiguration() {
  const authorize = new URL(getRequiredEnv("ION_AUTHORIZE_URL"));
  const token = new URL(getRequiredEnv("ION_TOKEN_URL"));
  if (authorize.protocol !== "https:" || token.protocol !== "https:") {
    throw new Error("ION OAuth endpoints must use HTTPS");
  }
  const server: oauth.AuthorizationServer = {
    issuer: authorize.origin,
    authorization_endpoint: authorize.href,
    token_endpoint: token.href,
    code_challenge_methods_supported: ["S256"],
  };
  const client: oauth.Client = { client_id: getRequiredEnv("ION_CLIENT_ID") };
  const redirectUri = getRequiredEnv("ION_REDIRECT_URI");
  if (redirectUri !== new URL("/api/v1/auth/ion/callback", getAppUrl()).href) throw new Error("ION callback must exactly match APP_URL.");
  return {
    server,
    client,
    clientAuth: oauth.ClientSecretPost(getRequiredEnv("ION_CLIENT_SECRET")),
    redirectUri,
  };
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\x00-\x20]/.test(value) || /%2f|%5c|%2e/i.test(value)) return "/courses";
  if (new URL(value, "https://opentj.invalid").pathname !== value.split(/[?#]/, 1)[0]) return "/courses";
  const path = value.split("?", 1)[0] ?? "";
  const allowed = ["/courses", "/me/practice", "/policy", "/moderation", "/admin"];
  return allowed.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ? value : "/courses";
}

export async function beginIonAuthorization(returnTo?: string | null): Promise<{ url: URL; binding: string }> {
  const { server, client, redirectUri } = oauthConfiguration();
  const state = oauth.generateRandomState();
  const binding = randomToken();
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  await db.oAuthTransaction.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.oAuthTransaction.create({
    data: {
      stateHash: sha256(state),
      browserHash: sha256(binding),
      codeVerifier,
      returnTo: sanitizeReturnTo(returnTo),
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  const url = new URL(server.authorization_endpoint!);
  url.searchParams.set("client_id", client.client_id);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { url, binding };
}

async function getIonProfile(accessToken: string) {
  const profileUrl = new URL(getRequiredEnv("ION_PROFILE_URL"));
  if (profileUrl.protocol !== "https:") throw new Error("ION profile endpoint must use HTTPS");
  const response = await fetch(profileUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new AppError(502, "ION_PROFILE_FAILED", "ION did not return a usable profile.");
  return ionProfileSchema.parse(await response.json());
}

async function revokeIonToken(accessToken: string): Promise<void> {
  const revokeUrl = process.env.ION_REVOKE_URL?.trim();
  if (!revokeUrl) return;
  try {
    const url = new URL(revokeUrl);
    if (url.protocol !== "https:") return;
    const body = new URLSearchParams({
      token: accessToken,
      client_id: getRequiredEnv("ION_CLIENT_ID"),
      client_secret: getRequiredEnv("ION_CLIENT_SECRET"),
    });
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // The short-lived token is never persisted; revocation is best effort.
  }
}

async function upsertIonUser(profile: z.infer<typeof ionProfileSchema>): Promise<PublicUser> {
  const ionId = String(profile.id);
  const displayName =
    profile.full_name ??
    profile.display_name ??
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ??
    profile.username;
  const existing = await db.user.findFirst({
    where: { OR: [{ ionId }, { username: profile.username }] },
  });
  if (existing && existing.ionId !== ionId) {
    throw new AppError(409, "IDENTITY_CONFLICT", "That username is already linked to another ION identity.");
  }
  const user = existing
    ? await db.user.update({
        where: { id: existing.id },
        data: {
          ionId,
          username: profile.username,
          displayName: displayName || profile.username,
          isStudent: profile.isStudent,
          isTeacher: profile.isTeacher,
        },
      })
    : await db.user.create({
        data: {
          ionId,
          username: profile.username,
          displayName: displayName || profile.username,
          isStudent: profile.isStudent,
          isTeacher: profile.isTeacher,
        },
      });

  const bootstrapIds = new Set(
    (process.env.BOOTSTRAP_ADMIN_ION_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (bootstrapIds.has(ionId)) {
    await db.$transaction(async (tx) => {
      // Bootstrap establishes the first administrator only. Existing grants
      // prevent regranting a revoked role even after audit retention expires.
      if (await tx.roleGrant.count({ where: { role: PlatformRole.PLATFORM_ADMIN } })) return;
      const prior = await tx.auditEvent.findFirst({ where: { action: "BOOTSTRAP_ADMIN", targetId: user.id } });
      if (prior) return;
      await tx.roleGrant.upsert({ where: { userId_role: { userId: user.id, role: PlatformRole.PLATFORM_ADMIN } }, create: { userId: user.id, role: PlatformRole.PLATFORM_ADMIN, grantedById: user.id }, update: {} });
      await tx.auditEvent.create({ data: { actorId: user.id, action: "BOOTSTRAP_ADMIN", targetType: "User", targetId: user.id, requestId: "bootstrap" } });
    });
  }
  const { id, username, displayName: name, isStudent, isTeacher, accountStatus } = user;
  return { id, username, displayName: name, isStudent, isTeacher, accountStatus };
}

/**
 * Says why a sign-in failed, for the server log. The login page only shows a general
 * message, so this is the one place the cause is recorded. It never includes the
 * authorization code, state, tokens or profile values.
 */
export function describeIonFailure(error: unknown): string {
  const reason = error instanceof AppError && error.code === "ION_LOGIN_FAILED" ? error.cause : error;
  const word = (value: unknown) => String(value).replace(/[^\w.-]/g, "?").slice(0, 60);
  if (reason instanceof AppError) return reason.code;
  if (reason instanceof oauth.ResponseBodyError) return `ION token endpoint answered ${reason.status} ${word(reason.error)}`;
  if (reason instanceof oauth.AuthorizationResponseError) return `ION authorization answered ${word(reason.error)}`;
  if (reason instanceof z.ZodError) return `ION profile fields not understood: ${[...new Set(reason.issues.map((issue) => issue.path.join(".") || "profile"))].join(", ")}`;
  if (!(reason instanceof Error)) return "unknown";
  // Database errors can quote the values involved, so only their kind is recorded.
  if (reason.name.startsWith("PrismaClient")) return "code" in reason ? `${reason.name} ${word(reason.code)}` : reason.name;
  const cause = reason.cause instanceof Error && "code" in reason.cause ? ` (${word(reason.cause.code)})` : "";
  return `${reason.name}: ${(reason.message.split("\n", 1)[0] ?? "").slice(0, 200)}${cause}`;
}

export async function finishIonAuthorization(query: URLSearchParams, binding?: string): Promise<{ user: PublicUser; returnTo: string }> {
  const state = query.get("state");
  if (!state || state.length > 200 || !binding || binding.length > 200) throw new AppError(400, "OAUTH_STATE_MISSING", "ION login state was missing.");
  const transaction = await db.oAuthTransaction.findUnique({ where: { stateHash: sha256(state) } });
  if (!transaction || transaction.expiresAt <= new Date() || !safeEqual(transaction.browserHash, sha256(binding))) {
    if (transaction && transaction.expiresAt <= new Date()) await db.oAuthTransaction.deleteMany({ where: { id: transaction.id } });
    throw new AppError(400, "OAUTH_STATE_INVALID", "ION login expired or was already used.");
  }
  const consumed = await db.oAuthTransaction.deleteMany({ where: { id: transaction.id, browserHash: sha256(binding), expiresAt: { gt: new Date() } } });
  if (consumed.count !== 1) throw new AppError(400, "OAUTH_STATE_INVALID", "ION login expired or was already used.");

  const { server, client, clientAuth, redirectUri } = oauthConfiguration();
  let accessToken: string | undefined;
  try {
    // oauth4webapi accepts only a genuine URL or URLSearchParams. A Next.js route's
    // request.nextUrl is neither, so it is given a plain copy of the query instead.
    const parameters = oauth.validateAuthResponse(server, client, new URLSearchParams(query), state);
    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      server,
      client,
      clientAuth,
      parameters,
      redirectUri,
      transaction.codeVerifier,
      { signal: AbortSignal.timeout(10_000) },
    );
    const tokens = await oauth.processAuthorizationCodeResponse(server, client, tokenResponse);
    accessToken = tokens.access_token;
    if (!accessToken) throw new AppError(502, "ION_TOKEN_FAILED", "ION did not return an access token.");
    const profile = await getIonProfile(accessToken);
    const user = await upsertIonUser(profile);
    if (user.accountStatus !== "ACTIVE") throw new AppError(403, "ACCOUNT_RESTRICTED", "This account is restricted.");
    return { user, returnTo: sanitizeReturnTo(transaction.returnTo) };
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, "ION_LOGIN_FAILED", "ION login could not be completed.", undefined, { cause: error });
  } finally {
    if (accessToken) await revokeIonToken(accessToken);
  }
}
