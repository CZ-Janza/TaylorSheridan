#!/usr/bin/env node
/**
 * Jednorázová publikace doplňku do centrálního katalogu Stremia.
 *
 * Spusťte AŽ POTOM, co:
 *   1. běží GitHub Pages a manifest je dostupný na veřejné HTTPS adrese,
 *   2. proběhl první úspěšný běh workflow a katalogy nejsou prázdné,
 *   3. jste si doplněk sami nainstalovali a ověřili, že funguje.
 *
 * Spuštění:  node scripts/publish.js
 */

const TRANSPORT_URL = "https://cz-janza.github.io/TaylorSheridan/manifest.json";

async function main() {
  // Kontrola, že manifest je opravdu veřejně dostupný
  const check = await fetch(TRANSPORT_URL);
  if (!check.ok) {
    throw new Error(
      `Manifest není dostupný (HTTP ${check.status}). Máte zapnuté GitHub Pages?`
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
    throw new Error(`Stremio API odmítlo publikaci: ${JSON.stringify(data.error)}`);
  }
  console.log("Publikováno do centrálního katalogu Stremia!");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error("CHYBA:", err.message);
  process.exit(1);
});
