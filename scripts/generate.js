#!/usr/bin/env node
/**
 * Catalog generator for the "Taylor Sheridan" Stremio add-on.
 *
 * 1. Find the person on TMDB (by name, or config.person.tmdbId).
 * 2. Download the complete filmography (combined_credits).
 * 3. Filter titles by the roles in config.includeJobs.
 * 4. Resolve the IMDb ID for each title (Stremio uses "tt..." identifiers).
 * 5. Write docs/catalog/{movie,series}/*.json — one catalog per configured
 *    variant (newest / popular / top rated, optionally narrowed to a role),
 *    each with a view per genre, and rewrite the manifest to match.
 *
 * Run:  TMDB_API_KEY=xxx node scripts/generate.js
 * Requires Node.js 18+ (native fetch), no dependencies.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));

const { tmdb, sleep } = require("./lib/tmdb");
const {
  buildMeta,
  META_SORTS,
  resetCatalog,
  writeCatalog,
  writeManifest,
  catalogEntry,
} = require("./lib/catalog");
const { ALL_GENRE_LABELS, genreLabelsFromIds } = require("./lib/genres");

// A filmography is short and every title is wanted, so unlike the BBC catalog
// nothing is capped — but an announced project with no date yet is the most
// interesting entry there is, so those sort to the very top.
const UNDATED_SORTS_AS = "9999-12-31";

const VARIANTS = (CONFIG.catalogVariants || []).map((v) => {
  if (!META_SORTS[v.sortBy]) {
    throw new Error(
      `Unknown sortBy "${v.sortBy}" in catalogVariants — use ${Object.keys(META_SORTS).join(", ")}.`
    );
  }
  return v;
});
if (VARIANTS.length === 0) throw new Error("config.json: catalogVariants is empty.");

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

    // Credits records already carry genre ids, ratings and popularity, so the
    // genre views and the ordering variants cost no extra requests.
    const genres = genreLabelsFromIds(entry.genre_ids);

    const meta = buildMeta({
      tmdbEntry: entry,
      imdbId,
      isMovie,
      name: entry.title || entry.name,
      overview,
      date,
      status,
      jobs,
      undatedSortsAs: UNDATED_SORTS_AS,
    });
    meta.genres = genres.length ? genres : undefined;
    meta._genres = genres;
    meta._pop = entry.popularity || 0;
    meta._rating = entry.vote_average || 0;

    (isMovie ? movies : series).push(meta);
    console.log(
      `  + ${meta.type === "movie" ? "movie " : "series"} ${meta.name} (${imdbId}) [${meta._jobs.join(", ")}]`
    );
  }

  // Manually added titles from config (IMDb ID only – Cinemeta supplies
  // metadata). Nothing is known about them here, so they carry no genres and
  // sit with the unscheduled projects at the top.
  const manual = (id, type) => ({
    id,
    type,
    name: id,
    _date: UNDATED_SORTS_AS,
    _jobs: ["Manual"],
    _genres: [],
    _pop: 0,
    _rating: 0,
  });
  for (const id of CONFIG.extraImdbIds.movies || []) {
    if (!movies.some((m) => m.id === id)) movies.push(manual(id, "movie"));
  }
  for (const id of CONFIG.extraImdbIds.series || []) {
    if (!series.some((m) => m.id === id)) series.push(manual(id, "series"));
  }

  // Only rebuild the catalog tree once everything resolved, so a failure
  // halfway through leaves the published add-on untouched.
  resetCatalog(OUT_DIR);

  const pageSize = CONFIG.pageSize || 0;
  const minGenreItems = CONFIG.minGenreItems || 1;
  const catalogs = [];

  for (const [type, all] of [
    ["movie", movies],
    ["series", series],
  ]) {
    for (const variant of VARIANTS) {
      // A variant may narrow the catalog to titles Sheridan held a given role
      // on — "everything he directed", say — which is what a filmography can
      // filter by that a broad catalog cannot.
      const metas = all
        .filter((m) => !variant.jobs || (m._jobs || []).some((j) => variant.jobs.includes(j)))
        .sort(META_SORTS[variant.sortBy]);
      if (metas.length === 0) continue;

      const id = `taylor-sheridan-${type === "movie" ? "movies" : "series"}${variant.idSuffix || ""}`;
      const genres = writeCatalog({
        baseDir: OUT_DIR,
        type,
        id,
        metas,
        pageSize,
        genres: CONFIG.genreFilter === false ? [] : ALL_GENRE_LABELS,
        minGenreItems,
      });

      catalogs.push(catalogEntry({ type, id, name: variant.name, genres }));
    }
  }

  writeManifest(MANIFEST, catalogs);
  console.log(`Done. ${movies.length} movies, ${series.length} series.`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
