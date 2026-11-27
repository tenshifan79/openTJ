# Running openTJ on Director

Director gives each site about 95 MiB of RAM (plus the same again in swap) and
at most one CPU. `npm ci` and `next build` do not fit, so nothing is built there.
GitHub Actions builds and tests the application on Node 22.9.0, then the
**Publish Director release** job attaches three files to a GitHub release:

- `opentj-director-linux-x64.tar.gz`: `web/` (Next.js standalone server),
  `tasks/` (migrations, seed, worker) and the launch scripts
- `SHA256SUMS`
- `deploy.sh`, the installer

Release assets are public and permanent, so Director downloads them with curl.
The five newest packages are kept. To rebuild without a commit, run the CI
workflow from the Actions tab (**Run workflow** on `main`).

## One-time setup

1. In Director choose the **Node.js 22.9 (Debian)** image (the package is
   glibc x86-64, not Alpine) and add a PostgreSQL database.
2. Create `/site/private/opentj.env` (see the next section).
3. In the Web Terminal:

   ```sh
   mkdir -p /site/private/opentj && cd /site/private/opentj
   curl -fsSLO https://github.com/tenshifan79/openTJ/releases/latest/download/deploy.sh
   sh deploy.sh
   ```

   `deploy.sh` verifies the checksum, extracts into
   `/site/private/opentj/releases/<id>/`, applies migrations and the production
   seed, points the `current` symlink at the new release and, if Director has
   no `run.sh` yet, creates `/site/run.sh`.
4. Click **Restart process** once. Check **Process Log**, then
   `https://<site>.sites.tjhsst.edu/api/health`.

## Configuration

`/site/private/opentj.env` holds everything except the database, in dotenv
format. Keep it out of Git and out of `public/`.

```dotenv
APP_URL=https://opentj.sites.tjhsst.edu
ION_REDIRECT_URI=https://opentj.sites.tjhsst.edu/api/v1/auth/ion/callback
ION_CLIENT_ID=
ION_CLIENT_SECRET=
ION_AUTHORIZE_URL=https://ion.tjhsst.edu/oauth/authorize/
ION_TOKEN_URL=https://ion.tjhsst.edu/oauth/token/
ION_PROFILE_URL=https://ion.tjhsst.edu/api/profile
ION_REVOKE_URL=https://ion.tjhsst.edu/oauth/revoke_token/
SESSION_SECRET=
BOOTSTRAP_ADMIN_ION_IDS=
OPENTJ_DB_SCHEMA=opentj
STORAGE_DRIVER=disabled
TRUST_PROXY=true
```

- **Database.** Director injects `DATABASE_URL`/`DIRECTOR_DATABASE_URL`; never
  copy the URL into this file, because Director can change it. The launcher
  adds `connection_limit=3` unless the URL already sets one (`OPENTJ_DB_POOL`
  changes the number).
- **Schema.** Director's database user cannot create tables in the `public`
  schema (PostgreSQL 15 and later; migrations fail with `permission denied for
  schema public`). `OPENTJ_DB_SCHEMA=opentj` keeps all tables in a schema the
  site owns, which the first migration creates. In Director's Database shell
  run `SET search_path TO opentj;` before querying. Keep the existing schema
  setting when upgrading a site with course data.
- **Ion.** Register a *Confidential*, *Authorization code* application at
  `https://ion.tjhsst.edu/oauth/applications/` with the redirect URI above. Ion
  shows the client secret only when it is created. If sign-in ends on the login
  page with "ION sign-in could not be completed", the Process Log has the cause
  in an `ION sign-in failed` line; `ION token endpoint answered 401
  invalid_client`, for example, means the client ID or secret here is wrong.
- **Session secret.** Generate it on the host so it never leaves it:
  `printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" >> /site/private/opentj.env`
- **Materials.** Use Drive, Docs, and Slides links on Director. To keep previously
  approved PDFs readable, use `STORAGE_DRIVER=s3` and the private `S3_*` settings
  in `.env.example`. `PDF_UPLOADS_ENABLED=true` enables new PDF submissions in
  local development.
- **Proxy.** Director's proxy overwrites `X-Forwarded-For` with the client
  address, so `TRUST_PROXY=true` gives per-client rate limits. Without it every
  visitor shares one sign-in limit.

The web process refuses to start while required settings are missing and
prints the reason in the Process Log. `run.sh` retries by itself (at most a
minute apart), so the site comes up shortly after the file is fixed.

## Updating and rolling back

```sh
sh /site/private/opentj/current/deploy.sh             # latest release
sh /site/private/opentj/current/deploy.sh <tag>       # a specific release
sh /site/private/opentj/current/deploy.sh --rollback  # previous release
```

The running server notices the new `current` release within a few seconds and
switches to it; no Director restart is needed. The previous release stays
installed for `--rollback`. Before upgrading the schema, restore a database
and private object backup into staging, apply the release migrations, and
verify member access, a legacy bookmark, period dates, and a stored PDF if
configured. To recover the pre-upgrade data, restore the matching database and
object backup before starting the previous release.

## Memory

With stock settings the server starts near 60 MiB of private memory and passed
220 MiB under load in testing, which Director kills. `run.sh` therefore sets:

- `--optimize-for-size --max-semi-space-size=1`: V8 collects early instead of
  sizing its heap from the host's RAM; `--max-old-space-size=96` is a ceiling
  for safety, well above the usual 50-60 MiB heap
- one glibc malloc arena with low trim thresholds, so native memory is returned
- a three-connection database pool

Measured with these settings on Node 22.9.0: about 42 MiB at start, 65 MiB
after every page has been loaded and 75-80 MiB after sustained load. Override
with `OPENTJ_NODE_FLAGS`, the `MALLOC_*` variables or `OPENTJ_DB_POOL`.

Director stops restarting a site after five failed starts, so `run.sh` also
restarts the server itself if it exits (set `OPENTJ_SUPERVISE=0` on hosts that
supervise processes). `prisma migrate deploy` peaks near 150 MiB and leans on
Director's swap for a few seconds during a deploy. If the site still runs
short, ask director@tjhsst.edu for a higher memory limit.

## Not available on Director

The PDF worker (`worker.sh`) needs ClamAV and more memory than a site gets. It
also performs the hourly retention sweep; run it once from the Web Terminal
when needed:

```sh
sh /site/private/opentj/current/worker.sh --once
```
