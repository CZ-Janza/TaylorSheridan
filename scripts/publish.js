#!/usr/bin/env node
/**
 * Publish the add-ons to Stremio's central catalog, so they show up in the
 * community add-ons list instead of only working for people you sent the URL
 * to. Publishing registers the manifest URL — Stremio keeps pulling catalog
 * updates from it, so this is a one-time step, not part of the weekly job.
 *
 * Run this ONLY AFTER:
 *   1. GitHub Pages is live and the manifest is reachable at a public HTTPS URL,
 *   2. the last workflow run succeeded and the catalogs are not empty,
 *   3. you installed the add-on yourself and verified it works.
 *
 * Run:  node scripts/publish.js            # both add-ons
 *       node scripts/publish.js bbc        # just one of them
 */

const ADDONS = {
  sheridan: "https://cz-janza.github.io/TaylorSheridan/manifest.json",
  bbc: "https://cz-janza.github.io/TaylorSheridan/bbc/manifest.json",
};

/** Refuse to publish a manifest that would embarrass us in a public list. */
async function verify(transportUrl) {
  const res = await fetch(transportUrl);
  if (!res.ok) {
    throw new Error(`manifest not reachable (HTTP ${res.status}) — is GitHub Pages enabled?`);
  }
  const manifest = await res.json();

  for (const field of ["id", "version", "name", "resources", "types", "catalogs"]) {
    if (!manifest[field]) throw new Error(`manifest is missing "${field}"`);
  }
  if (!manifest.catalogs.length) throw new Error("manifest declares no catalogs");

  // A catalog listed in the manifest but missing on disk shows up as an empty
  // row for everyone who installs the add-on.
  const base = transportUrl.replace(/manifest\.json$/, "");
  for (const c of manifest.catalogs) {
    const url = `${base}catalog/${c.type}/${c.id}.json`;
    const page = await fetch(url);
    if (!page.ok) throw new Error(`catalog "${c.id}" is unreachable (HTTP ${page.status})`);
    const { metas } = await page.json();
    if (!metas || metas.length === 0) throw new Error(`catalog "${c.id}" is empty`);
  }

  return manifest;
}

async function publish(key, transportUrl) {
  const manifest = await verify(transportUrl);
  console.log(
    `${key}: ${manifest.name} v${manifest.version}, ${manifest.catalogs.length} catalogs — OK`
  );

  const res = await fetch("https://api.strem.io/api/addonPublish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transportUrl }),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Stremio API rejected the publish: ${JSON.stringify(data.error)}`);
  }
  console.log(`${key}: published → ${transportUrl}`);
  return data;
}

async function main() {
  const wanted = process.argv.slice(2);
  const keys = wanted.length ? wanted : Object.keys(ADDONS);

  for (const key of keys) {
    if (!ADDONS[key]) {
      throw new Error(`Unknown add-on "${key}" — use one of: ${Object.keys(ADDONS).join(", ")}`);
    }
  }

  for (const key of keys) {
    try {
      await publish(key, ADDONS[key]);
    } catch (err) {
      // One rejected add-on should not stop the other from being published.
      console.error(`${key}: FAILED — ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log(
    "\nPublishing is one-time. Catalog updates propagate on their own, because" +
      " Stremio pulls them from the manifest URL."
  );
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
