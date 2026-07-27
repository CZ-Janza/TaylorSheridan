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
 * 3. Query /discover for movies and TV produced by those companies/networks,
 *    letting TMDB drop the show types and genres we do not want.
 * 4. Resolve the IMDb ID for each title (Stremio uses "tt..." identifiers).
 * 5. Write docs/bbc/catalog/{movie,series}/*.json — one catalog per configured
 *    variant (newest / popular / top rated), each split into "skip" pages and
 *    into a view per genre, and rewrite the manifest to match.
 *
 * Run:  TMDB_API_KEY=xxx node scripts/generate-bbc.js
 * Requires Node.js 18+ (native fetch), no dependencies.
 */

const fs = require("fs");
const path = require("path");
const { tmdb, mapLimit } = require("./lib/tmdb");
const {
  TODAY,
  buildMeta,
  byDateDesc,
  resetCatalog,
  writeCatalog,
} = require("./lib/catalog");
const { ALL_GENRE_LABELS, genreLabels } = require("./lib/genres");

const ROOT = path.join(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "bbc");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "config.bbc.json"), "utf8"));

const LANG = CONFIG.language || "en-US";
const CONCURRENCY = 8;
const INCLUDE_UNRELEASED = CONFIG.includeUnreleased === true;

/** TMDB uses "movie"/"tv"; the config keys read better as "movies"/"series". */
const configKey = (kind) => (kind === "movie" ? "movies" : "series");

/** The catalog id and Stremio type for a TMDB kind. */
const catalogBase = (kind) => (kind === "movie" ? "bbc-movies" : "bbc-series");
const stremioType = (kind) => (kind === "movie" ? "movie" : "series");

/** The date field /discover sorts and filters on differs per type. */
const dateField = (kind) => (kind === "movie" ? "primary_release_date" : "first_air_date");

/** The date of a raw /discover result. */
const entryDate = (kind, r) => (kind === "movie" ? r.release_date : r.first_air_date) || "";

/**
 * The orderings a catalog variant can use. Each needs a TMDB sort (so the
 * right titles are discovered in the first place), a comparator for raw
 * /discover results (used to trim the pool before spending a request per
 * title) and one for finished metas.
 */
const SORTS = {
  date: {
    tmdb: (kind) => `${dateField(kind)}.desc`,
    raw: (kind) => (a, b) => entryDate(kind, b).localeCompare(entryDate(kind, a)),
    meta: byDateDesc,
  },
  popularity: {
    tmdb: () => "popularity.desc",
    raw: () => (a, b) => (b.popularity || 0) - (a.popularity || 0),
    meta: (a, b) => (b._pop || 0) - (a._pop || 0),
  },
  rating: {
    tmdb: () => "vote_average.desc",
    raw: () => (a, b) => (b.vote_average || 0) - (a.vote_average || 0),
    meta: (a, b) => (b._rating || 0) - (a._rating || 0),
  },
};

const VARIANTS = (CONFIG.catalogVariants || []).map((v) => {
  if (!SORTS[v.sortBy]) {
    throw new Error(
      `Unknown sortBy "${v.sortBy}" in catalogVariants — use ${Object.keys(SORTS).join(", ")}.`
    );
  }
  return v;
});
if (VARIANTS.length === 0) throw new Error("config.bbc.json: catalogVariants is empty.");

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
 * The /discover filters that decide what may enter the catalog at all.
 *
 * Doing this at the TMDB end rather than after the fact matters: anything
 * rejected here never eats into the `maxItemsPerType` budget, so the cap fills
 * up with titles we actually want.
 */
function discoverFilters(kind) {
  const key = configKey(kind);
  const base = {};

  if (kind === "movie") base.include_adult = false;
  if (CONFIG.minVoteCount > 0) base["vote_count.gte"] = CONFIG.minVoteCount;
  if (CONFIG.minRating > 0) base["vote_average.gte"] = CONFIG.minRating;
  if (!INCLUDE_UNRELEASED) base[`${dateField(kind)}.lte`] = TODAY;

  const genres = (CONFIG.excludeGenreIds || {})[key] || [];
  if (genres.length) base.without_genres = genres.join(",");

  // TV only: TMDB classifies every show as documentary / news / miniseries /
  // reality / scripted / talk show / video, independently of its genres. That
  // catches the programmes no genre describes — sport, music, magazine shows.
  const types = (CONFIG.withTypes || {})[key] || [];
  if (kind === "tv" && types.length) base.with_type = types.join("|");

  return base;
}

/** Page through /discover for every id chunk and collect unique results. */
async function discover(kind, paramName, ids, sortBy, maxItems) {
  const found = new Map();
  const maxPages = Math.ceil(maxItems / 20) + 2;
  const filters = discoverFilters(kind);

  for (const ids20 of chunk(ids)) {
    const base = {
      ...filters,
      sort_by: SORTS[sortBy].tmdb(kind),
      language: LANG,
      [paramName]: ids20.join("|"),
    };

    for (let page = 1; page <= Math.min(maxPages, 500); page++) {
      const data = await tmdb(`/discover/${kind}`, { ...base, page });
      for (const r of data.results || []) if (!found.has(r.id)) found.set(r.id, r);
      if (page >= (data.total_pages || 1)) break;
    }
  }

  return found;
}

/**
 * Collect the candidate pool for one type: every variant's ordering is fetched
 * separately, because "the 500 newest" and "the 500 most popular" are largely
 * different sets and each catalog should be complete in its own right.
 */
async function discoverPool(kind, companyIds, networkIds, maxItems) {
  const pool = new Map();
  const sortModes = [...new Set(VARIANTS.map((v) => v.sortBy))];

  for (const sortBy of sortModes) {
    const hits = await discover(kind, "with_companies", companyIds, sortBy, maxItems);
    // Networks are a TV concept; movies only have production companies.
    if (kind === "tv" && networkIds.length) {
      const byNetwork = await discover(kind, "with_networks", networkIds, sortBy, maxItems);
      for (const [id, r] of byNetwork) if (!hits.has(id)) hits.set(id, r);
    }
    for (const [id, r] of hits) if (!pool.has(id)) pool.set(id, r);
  }

  return pool;
}

/**
 * Trim the pool to the titles that make the cut for at least one variant, so we
 * spend one TMDB request per title we are actually going to publish.
 */
function shortlist(kind, pool, maxItems) {
  const key = configKey(kind);
  const excluded = (CONFIG.excludeTmdbIds || {})[key] || [];
  const namePattern = (CONFIG.excludeNamePattern || {})[key];
  // Genres and show types do not cover everything – umbrella strands like
  // "Play for Today" are perfectly ordinary scripted drama as far as TMDB is
  // concerned. This is the escape hatch for the rest.
  const nameRe = namePattern ? new RegExp(namePattern, "i") : null;

  const eligible = [...pool.values()]
    .filter((r) => !excluded.includes(r.id))
    .filter((r) => !(nameRe && nameRe.test(r.name || r.title || "")))
    .filter((r) => INCLUDE_UNRELEASED || (entryDate(kind, r) && entryDate(kind, r) <= TODAY));

  const keep = new Map();
  for (const sortBy of new Set(VARIANTS.map((v) => v.sortBy))) {
    for (const r of [...eligible].sort(SORTS[sortBy].raw(kind)).slice(0, maxItems)) {
      keep.set(r.id, r);
    }
  }
  return [...keep.values()];
}

/**
 * Fetch full details + external IDs in a single request per title, so we get
 * the IMDb ID, genres, ratings and dates without a second round-trip.
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
    const genres = genreLabels(detail.genres);

    const meta = buildMeta({
      tmdbEntry: detail.poster_path ? detail : entry,
      imdbId,
      isMovie,
      name: detail.title || detail.name || entry.title || entry.name,
      overview,
      date,
      status: detail.status || null,
    });
    meta.genres = genres.length ? genres : undefined;
    meta._genres = genres;
    meta._pop = detail.popularity || entry.popularity || 0;
    meta._rating = detail.vote_average || entry.vote_average || 0;
    return meta;
  });

  return results.filter(Boolean);
}

/**
 * Rewrite the manifest's catalog list so the variants and the genre dropdown
 * always match what was actually written. Everything else in the manifest is
 * hand-maintained and left alone.
 */
function writeManifest(catalogs) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  manifest.catalogs = catalogs;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote manifest.json (${catalogs.length} catalogs)`);
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

  const resolved = {};
  for (const kind of ["movie", "tv"]) {
    const pool = await discoverPool(kind, companyIds, networkIds, max);
    const picked = shortlist(kind, pool, max);
    console.log(`${kind}: ${pool.size} discovered, ${picked.length} shortlisted, resolving…`);
    resolved[kind] = await resolveTitles(kind, picked);
  }

  // Only rebuild the catalog tree once every title has been resolved, so a
  // failure halfway through leaves the published add-on untouched.
  resetCatalog(OUT_DIR);

  const pageSize = CONFIG.pageSize || 0;
  const minGenreItems = CONFIG.minGenreItems || 1;
  const catalogs = [];

  for (const kind of ["movie", "tv"]) {
    for (const variant of VARIANTS) {
      const metas = [...resolved[kind]].sort(SORTS[variant.sortBy].meta).slice(0, max);
      const id = catalogBase(kind) + (variant.idSuffix || "");
      const type = stremioType(kind);

      const genres = writeCatalog({
        baseDir: OUT_DIR,
        type,
        id,
        metas,
        pageSize,
        genres: CONFIG.genreFilter === false ? [] : ALL_GENRE_LABELS,
        minGenreItems,
      });

      const extra = [{ name: "skip", isRequired: false }];
      if (genres.length) extra.unshift({ name: "genre", options: genres, isRequired: false });
      catalogs.push({ type, id, name: variant.name, extra });
    }
  }

  writeManifest(catalogs);
  console.log(`Done. ${resolved.movie.length} movies, ${resolved.tv.length} series.`);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
