#!/usr/bin/env node
/**
 * One-time publish of the add-on to Stremio's central catalog.
 *
 * Run this ONLY AFTER:
 *   1. GitHub Pages is live and the manifest is reachable at a public HTTPS URL,
 *   2. the first workflow run succeeded and the catalogs are not empty,
 *   3. you installed the add-on yourself and verified it works.
 *
 * Run:  node scripts/publish.js
 */

const TRANSPORT_URL = "https://cz-janza.github.io/TaylorSheridan/manifest.json";

async function main() {
  // Verify the manifest really is publicly reachable
  const check = await fetch(TRANSPORT_URL);
  if (!check.ok) {
    throw new Error(
      `Manifest is not reachable (HTTP ${check.status}). Is GitHub Pages enabled?`
    );
  }
  const manifest = await check.json();
  console.log(`Manifest OK: ${manifest.name} v${manifest.version}`);

  const res = await fetch("https://api.strem.io/api/addonPublish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transportUrl: TRANSPORT_URL }),
  });
  const data = await res.json();

  if (data.error) {
    throw new Error(`Stremio API rejected the publish: ${JSON.stringify(data.error)}`);
  }
  console.log("Published to Stremio's central catalog!");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
