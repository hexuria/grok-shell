#!/usr/bin/env node
// probe-oauth-apps.mjs — find catalog plugins whose HTTP connectors need a
// pre-registered OAuth app (no dynamic client registration), plus the ones
// only reachable through Cursor's / Grok's hosted gateways, and write
// server/plugins/needs-oauth-app.json. The server hides these from the
// catalog unless ROX_SHOW_OAUTH_APP_PLUGINS=1 (installed ones stay).
//
//   node tools/probe-oauth-apps.mjs
//
// Per connector: RFC 9728 protected-resource metadata (path-aware, or the
// WWW-Authenticate resource_metadata hint) → its authorization server's
// RFC 8414 / OIDC metadata → registration_endpoint? An mcp.json auth block
// with a CLIENT_ID counts as needing an app too. Servers without OAuth
// metadata (API keys, headers, stdio) are fine.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adjustServers } from "../server/plugin_resolve.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "server/plugins/needs-oauth-app.json");
const { plugins } = JSON.parse(readFileSync(join(ROOT, "server/plugins/grokbot-catalog.json"), "utf8"));
const { discoverOAuthProtectedResourceMetadata, discoverAuthorizationServerMetadata } = await import(
  join(ROOT, "node_modules/@modelcontextprotocol/sdk/dist/esm/client/auth.js")
);

const withTimeout = (p, ms = 12000) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);

// Expand ${VAR:-default}; null when a variable has no default (the URL is
// per-user and can't be probed).
function concreteUrl(u) {
  let ok = true;
  const out = String(u).replace(/\$\{([^}]+)\}/g, (_, inner) => {
    const d = inner.split(":-")[1];
    if (d === undefined || d === "" || d === "not-setup") ok = false;
    return d ?? "";
  });
  return ok ? out : null;
}

async function resourceMetadataUrlFromChallenge(url) {
  try {
    const r = await withTimeout(fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "1" } } }),
    }));
    const www = r.headers.get("www-authenticate") || "";
    return { status: r.status, hint: www.match(/resource_metadata="([^"]+)"/)?.[1] || null };
  } catch { return { status: 0, hint: null }; }
}

async function probe(url) {
  let prm = null;
  try { prm = await withTimeout(discoverOAuthProtectedResourceMetadata(url)); } catch {}
  let status = null;
  if (!prm?.authorization_servers?.length) {
    const ch = await resourceMetadataUrlFromChallenge(url);
    status = ch.status;
    if (ch.hint) try { prm = await withTimeout(discoverOAuthProtectedResourceMetadata(url, { resourceMetadataUrl: ch.hint })); } catch {}
  }
  // Legacy (2025-03) servers: no PRM, auth server metadata at the origin.
  const issuer = prm?.authorization_servers?.[0] || (status === 401 ? new URL("/", url).href : null);
  if (!issuer) return { oauth: false };
  let md = null;
  try { md = await withTimeout(discoverAuthorizationServerMetadata(issuer)); } catch {}
  if (!md) return { oauth: !!prm, issuer, dcr: null };
  return { oauth: true, issuer: md.issuer || issuer, dcr: !!md.registration_endpoint };
}

const HOW = {
  x: "Create an X developer app (OAuth 2.0, type Native App or Web App) with callback URL http://127.0.0.1:8787/oauth/callback/x; enter its Client ID (and Client Secret for Web App), or an app-only Bearer Token, in the X plugin's Setup.",
  google: "Create a Google Cloud OAuth client of type Desktop app (APIs & Services → Credentials) and enable the product's API; enter its Client ID and Client Secret once in any Google plugin's Setup — Gmail, Calendar, Drive, Docs, Sheets and Slides share it. Desktop clients accept the loopback redirect http://127.0.0.1:8787/oauth/callback/<connector> without registering it.",
};
const howFor = (issuer, connector) => {
  if (/accounts\.google\.com/.test(issuer || "")) return HOW.google;
  if (/api\.x\.com/.test(issuer || "")) return HOW.x;
  return `Register an OAuth app with ${issuer ? new URL(issuer).host : "the provider"} using callback URL http://127.0.0.1:8787/oauth/callback/${connector.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)}; enter its Client ID (and Client Secret if it's a confidential client) in the plugin's Setup.`;
};

const jobs = [];
for (const e of plugins) {
  for (const [connector, cfg] of Object.entries(adjustServers(e.install?.servers || {}))) {
    if (!cfg?.url) continue;
    jobs.push({ e, connector, cfg });
  }
}
const cache = new Map();
const results = [];
let i = 0;
await Promise.all(Array.from({ length: 12 }, async () => {
  while (i < jobs.length) {
    const { e, connector, cfg } = jobs[i++];
    if (cfg.unavailable) {
      results.push({ name: e.key, connector, kind: "hosted", authorization_server: new URL(cfg.url).host, reason: cfg.unavailable, how_to_enable: "Not possible without that vendor's account gateway." });
      continue;
    }
    // A credential header filled from setup values (API key / token)
    // signs the connector in without OAuth.
    if (!cfg.auth?.CLIENT_ID && Object.entries(cfg.headers || {}).some(([k, v]) => /auth|key|token/i.test(k) && /\$\{/.test(String(v)))) continue;
    const pinned = cfg.auth?.CLIENT_ID;
    const url = concreteUrl(cfg.url);
    if (!url) {
      if (pinned) results.push({ name: e.key, connector, kind: "oauth-app", authorization_server: null, reason: "mcp.json declares a pre-registered OAuth client (auth.CLIENT_ID); its URL is per-account", how_to_enable: howFor(null, connector) });
      continue;
    }
    if (!cache.has(url)) cache.set(url, probe(url));
    const p = await cache.get(url);
    if (p.oauth && p.dcr === false)
      results.push({ name: e.key, connector, kind: "oauth-app", authorization_server: p.issuer, reason: `${new URL(p.issuer).host} has no dynamic client registration${pinned ? "; mcp.json pins the vendor's own client id" : ""}`, how_to_enable: howFor(p.issuer, connector) });
    else if (pinned && !p.dcr)
      results.push({ name: e.key, connector, kind: "oauth-app", authorization_server: p.issuer || null, reason: `mcp.json declares a pre-registered OAuth client (auth.CLIENT_ID)${p.oauth ? "" : "; no OAuth metadata found to register one"}`, how_to_enable: howFor(p.issuer, connector) });
  }
}));
results.sort((a, b) => a.name.localeCompare(b.name) || a.connector.localeCompare(b.connector));
writeFileSync(OUT, JSON.stringify({ probedAt: new Date().toISOString(), plugins: results }, null, 1) + "\n");
const names = new Set(results.map((r) => r.name));
console.log(`${jobs.length} http connectors probed; ${names.size} plugins hidden (${results.filter((r) => r.kind === "oauth-app").length} oauth-app connectors, ${results.filter((r) => r.kind === "hosted").length} hosted)`);
for (const r of results) console.log(`  ${r.name}/${r.connector} [${r.kind}] ${r.reason}`);
