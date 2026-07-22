#!/usr/bin/env node
/**
 * Catalog generator for the "Taylor Sheridan" Stremio add-on.
 *
 * 1. Find the person on TMDB (by name, or config.person.tmdbId).
 * 2. Download the complete filmography (combined_credits).
 * 3. Filter titles by the roles in config.includeJobs.
 * 4. Resolve the IMDb ID for each title (Stremio uses "tt..." identifiers).
 * 5. Write docs/catalog/movie/*.json and docs/catalog/series/*.json.
 *
 * Run:  TMDB_API_KEY=xxx node scripts/generate.js
 * Requires Node.js 18+ (native fetch), no dependencies.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

const { tmdb, sleep, IMG } = require("./lib/tmdb");

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
    throw new Error(`Person "${CONFIG.person.name}" not found on TMDB.`);
  }
  // On name collisions pick the most popular (typically the right Sheridan)
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
  console.log(`Person: ${person.name} (TMDB id ${person.id})`);

  const credits = await tmdb(`/person/${person.id}/combined_credits`, {
    language: CONFIG.language || "en-US",
  });

  // key = media_type + tmdb id → { entry, jobs:Set }
  const picked = new Map();

  const addEntry = (c, role) => {
    if (CONFIG.excludeTmdbIds.includes(c.id)) return;
    const key = `${c.media_type}:${c.id}`;
    if (!picked.has(key)) picked.set(key, { entry: c, jobs: new Set() });
    picked.get(key).jobs.add(role);
  };

  for (const c of credits.crew || []) {
    if (c.media_type !== "movie" && c.media_type !== "tv") continue;
    // includeAllCrewJobs = include absolutely every crew role (producing, anything)
    if (CONFIG.includeAllCrewJobs) addEntry(c, c.job || "Crew");
    else if (jobMatches(c.job)) addEntry(c, c.job);
    // Series creators are usually in the "Creating" department on TMDB
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

  console.log(`Found ${picked.size} unique titles, resolving IMDb IDs…`);

  const movies = [];
  const series = [];

  const TODAY = new Date().toISOString().slice(0, 10);

  for (const { entry, jobs } of picked.values()) {
    const isMovie = entry.media_type === "movie";
    let date = isMovie ? entry.release_date : entry.first_air_date;
    let overview = entry.overview;
    let status = null;

    // The filmography summary often lacks a date/overview for upcoming titles.
    // Fetch the detail record to recover the expected date, TMDB status and
    // (if needed) a fallback description in the configured language.
    const needDetail = !date || !overview;
    if (needDetail) {
      const detail = await tmdb(`/${isMovie ? "movie" : "tv"}/${entry.id}`, {
        language: CONFIG.language || "en-US",
      });
      await sleep(120);
      date = date || (isMovie ? detail.release_date : detail.first_air_date);
      overview = overview || detail.overview || "";
      status = detail.status || null;
      // Last-resort description in the fallback language
      if (!overview && CONFIG.fallbackLanguage) {
        const fb = await tmdb(`/${isMovie ? "movie" : "tv"}/${entry.id}`, {
          language: CONFIG.fallbackLanguage,
        });
        overview = fb.overview || "";
        await sleep(120);
      }
    }

    if (!CONFIG.includeUnreleased && !date) continue;

    const ext = await tmdb(`/${isMovie ? "movie" : "tv"}/${entry.id}/external_ids`);
    await sleep(120); // be gentle to the API

    const imdbId = ext.imdb_id;
    if (!imdbId || !imdbId.startsWith("tt")) {
      console.log(`  – skipped (no IMDb ID): ${entry.title || entry.name}`);
      continue;
    }

    // "Upcoming" = no release date yet, or a date still in the future.
    const released = !!date && date <= TODAY;
    let name = entry.title || entry.name;
    let description = overview || undefined;
    if (!released) {
      name += " (upcoming)";
      // Put the expected date / production status in front of the description
      // so it's visible on the title's detail page even before Cinemeta has it.
      const when = date
        ? `Expected release: ${date}`
        : status
        ? `Not yet released — status: ${status}`
        : "Not yet released";
      description = `⏳ ${when}.` + (overview ? ` ${overview}` : "");
    }

    const meta = {
      id: imdbId,
      type: isMovie ? "movie" : "series",
      name,
      poster: entry.poster_path ? `${IMG}/w342${entry.poster_path}` : undefined,
      background: entry.backdrop_path ? `${IMG}/w780${entry.backdrop_path}` : undefined,
      description,
      releaseInfo: date ? String(date).slice(0, 4) : undefined,
      _date: date || "9999-12-31", // sort helper (Stremio never sees it)
      _jobs: [...jobs].sort(),
    };

    (isMovie ? movies : series).push(meta);
    console.log(
      `  + ${meta.type === "movie" ? "movie " : "series"} ${meta.name} (${imdbId}) [${meta._jobs.join(", ")}]`
    );
  }

  // Manually added titles from config (IMDb ID only – Cinemeta supplies metadata)
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

  // Newest first
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
    console.log(`Wrote ${relPath} (${metas.length} items)`);
  };

  write("catalog/movie/taylor-sheridan-movies.json", clean(movies));
  write("catalog/series/taylor-sheridan-series.json", clean(series));

  console.log("Done.");
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
