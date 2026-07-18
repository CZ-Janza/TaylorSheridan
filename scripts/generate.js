#!/usr/bin/env node
/**
 * Generátor katalogu pro Stremio doplněk "Taylor Sheridan".
 *
 * 1. Najde osobu na TMDB (podle jména, nebo config.person.tmdbId).
 * 2. Stáhne kompletní filmografii (combined_credits).
 * 3. Vyfiltruje tituly podle rolí v config.includeJobs.
 * 4. Pro každý titul zjistí IMDb ID (Stremio pracuje s "tt..." identifikátory).
 * 5. Zapíše docs/catalog/movie/*.json a docs/catalog/series/*.json.
 *
 * Spuštění:  TMDB_API_KEY=xxx node scripts/generate.js
 * Vyžaduje Node.js 18+ (nativní fetch), žádné závislosti.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

const API_KEY = process.env.TMDB_API_KEY;
if (!API_KEY) {
  console.error("Chybí proměnná prostředí TMDB_API_KEY.");
  console.error("Lokálně:  TMDB_API_KEY=xxx node scripts/generate.js");
  console.error("Na GitHubu: Settings → Secrets and variables → Actions → New repository secret");
  process.exit(1);
}

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

// TMDB nabízí dva typy klíčů a snadno se zamění:
//  – API Key (v3 auth): krátký, posílá se jako ?api_key=...
//  – API Read Access Token (v4): dlouhý JWT ("eyJ..."), posílá se v hlavičce
//    Authorization: Bearer ...
// Rozpoznáme, který klíč jsme dostali, a použijeme správnou metodu — takže
// funguje bez ohledu na to, který z nich uživatel do secretu vložil.
const USE_BEARER = API_KEY.startsWith("eyJ") || API_KEY.length > 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(endpoint, params = {}) {
  const url = new URL(TMDB + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const options = {};
  if (USE_BEARER) {
    options.headers = { Authorization: `Bearer ${API_KEY}` };
  } else {
    url.searchParams.set("api_key", API_KEY);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429) {
      // rate limit – počkej a zkus znovu
      await sleep(1500 * attempt);
      continue;
    }
    if (!res.ok) {
      const hint =
        res.status === 401
          ? " (401 = neplatný TMDB_API_KEY; zkontrolujte, že secret obsahuje" +
            " API Key v3 nebo Read Access Token v4)"
          : "";
      throw new Error(`TMDB ${endpoint} → HTTP ${res.status}${hint}`);
    }
    return res.json();
  }
  throw new Error(`TMDB ${endpoint} → opakovaný rate limit`);
}

async function findPerson() {
  if (CONFIG.person.tmdbId) {
    const p = await tmdb(`/person/${CONFIG.person.tmdbId}`);
    return { id: p.id, name: p.name };
  }
  const search = await tmdb("/search/person", { query: CONFIG.person.name });
  const wanted = CONFIG.person.name.trim().toLowerCase();
  const candidates = (search.results || []).filter(
    (p) => p.name.trim().toLowerCase() === wanted
  );
  if (candidates.length === 0) {
    throw new Error(`Osoba "${CONFIG.person.name}" na TMDB nenalezena.`);
  }
  // Při shodě jmen vyber nejpopulárnější (typicky ten správný Sheridan)
  candidates.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  return { id: candidates[0].id, name: candidates[0].name };
}

function jobMatches(job) {
  if (!job) return false;
  const j = job.toLowerCase();
  return CONFIG.includeJobs.some((w) => j === w.toLowerCase());
}

async function main() {
  const person = await findPerson();
  console.log(`Osoba: ${person.name} (TMDB id ${person.id})`);

  const credits = await tmdb(`/person/${person.id}/combined_credits`, {
    language: CONFIG.language || "en-US",
  });

  // klíč = media_type + tmdb id → { entry, jobs:Set }
  const picked = new Map();

  const addEntry = (c, role) => {
    if (CONFIG.excludeTmdbIds.includes(c.id)) return;
    const key = `${c.media_type}:${c.id}`;
    if (!picked.has(key)) picked.set(key, { entry: c, jobs: new Set() });
    picked.get(key).jobs.add(role);
  };

  for (const c of credits.crew || []) {
    if (c.media_type !== "movie" && c.media_type !== "tv") continue;
    // includeAllCrewJobs = zahrnout ÚPLNĚ každou roli ve štábu (produkce, cokoliv)
    if (CONFIG.includeAllCrewJobs) addEntry(c, c.job || "Crew");
    else if (jobMatches(c.job)) addEntry(c, c.job);
    // Tvůrci seriálů mívají na TMDB department "Creating"
    if (CONFIG.includeCreating && (c.department || "").toLowerCase() === "creating") {
      addEntry(c, "Creator");
    }
  }

  if (CONFIG.includeActing) {
    for (const c of credits.cast || []) {
      if (c.media_type !== "movie" && c.media_type !== "tv") continue;
      addEntry(c, "Actor");
    }
  }

  console.log(`Nalezeno ${picked.size} unikátních titulů, zjišťuji IMDb ID…`);

  const movies = [];
  const series = [];

  for (const { entry, jobs } of picked.values()) {
    const isMovie = entry.media_type === "movie";
    const date = isMovie ? entry.release_date : entry.first_air_date;

    if (!CONFIG.includeUnreleased && !date) continue;

    const ext = await tmdb(`/${isMovie ? "movie" : "tv"}/${entry.id}/external_ids`);
    await sleep(120); // šetrnost k API

    const imdbId = ext.imdb_id;
    if (!imdbId || !imdbId.startsWith("tt")) {
      console.log(`  – přeskočeno (bez IMDb ID): ${entry.title || entry.name}`);
      continue;
    }

    // Popis: preferuj jazyk z configu, když chybí, vezmi fallback
    let overview = entry.overview;
    if (!overview && CONFIG.fallbackLanguage) {
      const detail = await tmdb(`/${isMovie ? "movie" : "tv"}/${entry.id}`, {
        language: CONFIG.fallbackLanguage,
      });
      overview = detail.overview || "";
      await sleep(120);
    }

    const meta = {
      id: imdbId,
      type: isMovie ? "movie" : "series",
      name: entry.title || entry.name,
      poster: entry.poster_path ? `${IMG}/w342${entry.poster_path}` : undefined,
      background: entry.backdrop_path ? `${IMG}/w780${entry.backdrop_path}` : undefined,
      description: overview || undefined,
      releaseInfo: date ? String(date).slice(0, 4) : undefined,
      _date: date || "9999-12-31", // pomocné pole pro řazení (neuvidí Stremio)
      _jobs: [...jobs].sort(),
    };

    (isMovie ? movies : series).push(meta);
    console.log(
      `  + ${meta.type === "movie" ? "film   " : "seriál "} ${meta.name} (${imdbId}) [${meta._jobs.join(", ")}]`
    );
  }

  // Ručně přidané tituly z configu (jen IMDb ID – metadata dodá Cinemeta)
  for (const id of CONFIG.extraImdbIds.movies || []) {
    if (!movies.some((m) => m.id === id)) {
      movies.push({ id, type: "movie", name: id, _date: "9999-12-31", _jobs: ["Manual"] });
    }
  }
  for (const id of CONFIG.extraImdbIds.series || []) {
    if (!series.some((m) => m.id === id)) {
      series.push({ id, type: "series", name: id, _date: "9999-12-31", _jobs: ["Manual"] });
    }
  }

  // Nejnovější nahoře
  const byDateDesc = (a, b) => String(b._date).localeCompare(String(a._date));
  movies.sort(byDateDesc);
  series.sort(byDateDesc);

  const clean = (arr) =>
    arr.map(({ _date, _jobs, ...meta }) =>
      Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined))
    );

  const write = (relPath, metas) => {
    const file = path.join(ROOT, "docs", relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ metas }, null, 2) + "\n");
    console.log(`Zapsáno ${relPath} (${metas.length} položek)`);
  };

  write("catalog/movie/taylor-sheridan-movies.json", clean(movies));
  write("catalog/series/taylor-sheridan-series.json", clean(series));

  console.log("Hotovo.");
}

main().catch((err) => {
  console.error("CHYBA:", err.message);
  process.exit(1);
});
