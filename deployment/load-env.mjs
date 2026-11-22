import { existsSync } from "node:fs";

// Director supplies the database URL. Keep other secrets outside release folders.
const config = process.env.OPENTJ_ENV_FILE || "/site/private/opentj.env";
if (existsSync(config)) process.loadEnvFile(config);
else if (process.env.OPENTJ_ENV_FILE) throw new Error("Configured environment file is missing");
if (!process.env.DATABASE_URL && process.env.DIRECTOR_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DIRECTOR_DATABASE_URL;
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is missing");
// Director creates the database for the site but, on PostgreSQL 15 and later, its
// user may not create tables in "public". OPENTJ_DB_SCHEMA names a schema of the
// site's own instead; the first migration creates it.
const schema = process.env.OPENTJ_DB_SCHEMA?.trim();
if (schema && !/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error("OPENTJ_DB_SCHEMA must be a simple lower-case name");
// Prisma opens 2 x CPUs + 1 connections by default (17 on Director). A small pool
// saves memory and leaves room on a shared database server. Explicit values win.
try {
  const url = new URL(process.env.DATABASE_URL);
  if (schema && !url.searchParams.has("schema")) url.searchParams.set("schema", schema);
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", process.env.OPENTJ_DB_POOL || "3");
  if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "20");
  process.env.DATABASE_URL = url.href;
} catch { /* Leave an unusual connection string exactly as supplied. */ }
process.env.NODE_ENV = "production";
process.env.APP_ENV = "production";
process.env.DEMO_AUTH_ENABLED = "false";
process.env.HOSTNAME = process.env.HOST || "0.0.0.0";
process.env.PORT ||= "8080";
