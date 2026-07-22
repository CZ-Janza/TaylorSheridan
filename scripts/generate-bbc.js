#!/usr/bin/env node
/**
 * Catalog generator for the "BBC" Stremio add-on.
 *
 * Unlike the Taylor Sheridan catalog (which follows one person's filmography),
 * this one follows production companies and TV networks:
 *
 * 1. Discover every BBC production company on TMDB by name (BBC Films,
 *    BBC Studios, BBC Worldwide, … — so subsidiaries are picked up
 *    automatically instead of being hard-coded).
 * 2. Verify the configured candidate network IDs and keep the BBC channels
 *    (BBC One, BBC Two, CBBC, …).
 * 3. Query /discover for movies and TV produced by those companies/networks.
 * 4. Resolve the IMDb ID for each title (Stremio uses "tt..." identifiers).
 * 5. Write docs/bbc/catalog/{movie,series}/*.json, split into "skip" pages.
 *
 * Run:  TMDB_API_KEY=xxx node scripts/generate-bbc.js
 * Requires Node.js 18+ (native fetch), no dependencies.
 */

const fs = require("fs");
const path = require("path");
const { tmdb, mapLimit } = require("./lib/tmdb");
const { buildMeta, clean, byDateDesc, writeCatalog } = require("./lib/catalog");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "bbc");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.bbc.json"), "utf8"));

const LANG = CONFIG.language || "en-US";
const CONCURRENCY = 8;

/** Find all BBC production companies by searching TMDB company names. */
async function findCompanies() {
  const re = new RegExp(CONFIG.companyNamePattern, "i");
  // Some unrelated companies happen to start with "BBC" (e.g. the Italian
  // "BBC di Renato Barbieri") – drop them by name so no TMDB ID is needed.
  const excludeRe = CONFIG.companyNameExcludePattern
    ? new RegExp(CONFIG.companyNameExcludePattern, "i")
    : null;
  const found = new Map();

  for (const query of CONFIG.companyQueries || []) {
    for (let page = 1; page <= 20; page++) {
      const data = await tmdb("/search/company", { query, page });
      for (const c of data.results || []) {
        if (re.test(c.name) && !(excludeRe && excludeRe.test(c.name))) {
          found.set(c.id, c.name);
        }
      }
      if (page >= (data.total_pages || 1)) break;
    }
  }

  for (const id of CONFIG.extraCompanyIds || []) {
    if (!found.has(id)) {
      const c = await tmdb(`/company/${id}`);
      found.set(c.id, c.name);
    }
  }
  for (const id of CONFIG.excludeCompanyIds || []) found.delete(id);

  return found;
}

/**
 * Check which of the configured candidate network IDs really are BBC channels.
 * TMDB has no network search endpoint, so we verify candidates by name and
 * simply skip anything that isn't BBC.
 */
async function findNetworks() {
  const re = new RegExp(CONFIG.networkNamePattern, "i");
  const found = new Map();

  await mapLimit(CONFIG.candidateNetworkIds || [], CONCURRENCY, async (id) => {
    try {
      const n = await tmdb(`/network/${id}`);
      if (n && n.name && re.test(n.name)) found.set(n.id, n.name);
    } catch {
      // Unknown/removed network ID – ignore
    }
  });

  return found;
}

/** Split ids into chunks so the OR-joined query string stays a sane length. */
function chunk(ids, size = 20) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Page through /discover for every id chunk and collect unique results.
 * Results come back sorted by popularity, so the first pages hold the titles
 * people actually browse for.
 */
async function discover(kind, paramName, ids, maxItems) {
  const found = new Map();
  const maxPages = Math.ceil(maxItems / 20) + 2;

  for (const ids20 of chunk(ids)) {
    const base = {
      sort_by: "popularity.desc",
      language: LANG,
      [paramName]: ids20.join("|"),
    };
    if (kind === "movie") base.include_adult = false;
    if (CONFIG.minVoteCount > 0) base["vote_count.gte"] = CONFIG.minVoteCount;

    for (let page = 1; page <= Math.min(maxPages, 500); page++) {
      const data = await tmdb(`/discover/${kind}`, { ...base, page });
      for (const r of data.results || []) if (!found.has(r.id)) found.set(r.id, r);
      if (page >= (data.total_pages || 1)) break;
    }
  }

  return found;
}

/**
 * Fetch full details + external IDs in a single request per title, so we get
 * the IMDb ID, production status and dates without a second round-trip.
 */
async function resolveTitles(kind, entries) {
  const isMovie = kind === "movie";
  const results = await mapLimit(entries, CONCURRENCY, async (entry) => {
    let detail;
    try {
      detail = await tmdb(`/${kind}/${entry.id}`, {
        language: LANG,
        append_to_response: "external_ids",
      });
    } catch {
      return null;
    }

    const imdbId = (detail.external_ids || {}).imdb_id;
    if (!imdbId || !imdbId.startsWith("tt")) return null;

    let overview = detail.overview || entry.overview || "";
    if (!overview && CONFIG.fallbackLanguage && CONFIG.fallbackLanguage !== LANG) {
      try {
        const fb = await tmdb(`/${kind}/${entry.id}`, { language: CONFIG.fallbackLanguage });
        overview = fb.overview || "";
      } catch {
        /* keep empty description */
      }
    }

    const date = isMovie ? detail.release_date : detail.first_air_date;

    const meta = buildMeta({
      tmdbEntry: detail.poster_path ? detail : entry,
      imdbId,
      isMovie,
      name: detail.title || detail.name || entry.title || entry.name,
      overview,
      date,
      status: detail.status || null,
    });
    meta._pop = detail.popularity || entry.popularity || 0;
    return meta;
  });

  return results.filter(Boolean);
}

async function main() {
  const companies = await findCompanies();
  console.log(`BBC companies (${companies.size}): ${[...companies.values()].join(", ")}`);

  const networks = await findNetworks();
  console.log(`BBC networks (${networks.size}): ${[...networks.values()].join(", ")}`);

  if (companies.size === 0 && networks.size === 0) {
    throw new Error("No BBC companies or networks found – check config.bbc.json.");
  }

  const companyIds = [...companies.keys()];
  const networkIds = [...networks.keys()];
  const max = CONFIG.maxItemsPerType || 500;

  // Movies: production companies only (networks are a TV concept)
  const movieHits = await discover("movie", "with_companies", companyIds, max);

  // Series: union of company-produced and network-aired titles
  const seriesHits = await discover("tv", "with_companies", companyIds, max);
  if (networkIds.length) {
    const byNetwork = await discover("tv", "with_networks", networkIds, max);
    for (const [id, r] of byNetwork) if (!seriesHits.has(id)) seriesHits.set(id, r);
  }

  console.log(
    `Discovered ${movieHits.size} movies and ${seriesHits.size} series, resolving IMDb IDs…`
  );

  const excl = CONFIG.excludeTmdbIds || {};
  const pick = (hits, excluded = []) =>
    [...hits.values()]
      .filter((r) => !excluded.includes(r.id))
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
      .slice(0, max);

  const movies = await resolveTitles("movie", pick(movieHits, excl.movies));
  const series = await resolveTitles("tv", pick(seriesHits, excl.series));

  // Most popular first – that is what people browse a broad catalog for.
  const sorter =
    CONFIG.sortBy === "date" ? byDateDesc : (a, b) => (b._pop || 0) - (a._pop || 0);
  movies.sort(sorter);
  series.sort(sorter);

  const stripPop = (arr) => arr.map(({ _pop, ...m }) => m);
  const pageSize = CONFIG.pageSize || 0;

  writeCatalog({
    baseDir: OUT_DIR,
    type: "movie",
    id: "bbc-movies",
    metas: clean(stripPop(movies)),
    pageSize,
  });
  writeCatalog({
    baseDir: OUT_DIR,
    type: "series",
    id: "bbc-series",
    metas: clean(stripPop(series)),
    pageSize,
  });

  console.log(`Done. ${movies.length} movies, ${series.length} series.`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
