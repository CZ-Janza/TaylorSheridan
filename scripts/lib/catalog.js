/**
 * Shared helpers for building and writing Stremio catalog files.
 */

const fs = require("fs");
const path = require("path");
const { IMG } = require("./tmdb");

const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Build a Stremio meta preview object.
 *
 * Titles that have not been released yet get a visible "(upcoming)" marker and
 * their expected date / production status prepended to the description —
 * Stremio's metadata add-on (Cinemeta) has no data for unreleased titles, so
 * without this they show up as blank tiles.
 */
function buildMeta({
  tmdbEntry,
  imdbId,
  isMovie,
  name,
  overview,
  date,
  status,
  jobs,
  // Where a title with no date at all sorts. A broad catalog wants those last
  // (they are almost always noise); a filmography wants them first, since an
  // announced-but-unscheduled project is the interesting part.
  undatedSortsAs = "",
}) {
  const released = !!date && date <= TODAY;

  let displayName = name;
  let description = overview || undefined;

  if (!released) {
    displayName += " (upcoming)";
    const when = date
      ? `Expected release: ${date}`
      : status
      ? `Not yet released — status: ${status}`
      : "Not yet released";
    description = `⏳ ${when}.` + (overview ? ` ${overview}` : "");
  }

  return {
    id: imdbId,
    type: isMovie ? "movie" : "series",
    name: displayName,
    poster: tmdbEntry.poster_path ? `${IMG}/w342${tmdbEntry.poster_path}` : undefined,
    background: tmdbEntry.backdrop_path ? `${IMG}/w780${tmdbEntry.backdrop_path}` : undefined,
    description,
    releaseInfo: date ? String(date).slice(0, 4) : undefined,
    _date: date || undatedSortsAs, // sort helper (Stremio never sees it)
    _jobs: jobs ? [...jobs].sort() : undefined,
  };
}

/** Strip internal underscore fields and undefined values before writing. */
function clean(metas) {
  return metas.map((meta) =>
    Object.fromEntries(
      Object.entries(meta).filter(([k, v]) => !k.startsWith("_") && v !== undefined)
    )
  );
}

/** Newest first. */
const byDateDesc = (a, b) => String(b._date).localeCompare(String(a._date));

/**
 * The orderings a catalog variant can be published in. Both generators offer
 * the same three, so Discover behaves identically across the two add-ons.
 */
const META_SORTS = {
  date: byDateDesc,
  popularity: (a, b) => (b._pop || 0) - (a._pop || 0),
  rating: (a, b) => (b._rating || 0) - (a._rating || 0),
};

/**
 * Delete a catalog directory so a run cannot leave stale files behind — a genre
 * that lost its last title, or a "skip" page past the end of a shrunken list,
 * would otherwise keep being served forever.
 */
function resetCatalog(baseDir) {
  fs.rmSync(path.join(baseDir, "catalog"), { recursive: true, force: true });
}

/**
 * Write one catalog view (the whole catalog, or one genre of it), split into
 * Stremio "skip" pages.
 *
 * Stremio asks for /catalog/{type}/{id}.json first, then adds the selected
 * "extra" properties as a query-string-ish path segment:
 * /catalog/{type}/{id}/genre=Drama.json, /catalog/{type}/{id}/genre=Drama&skip=100.json
 *
 * A static file per combination is enough to make filtering and scrolling work
 * without a server. Clients are not perfectly consistent about the order they
 * join the extras in, so pages are written under both orderings — they are only
 * a handful of files and a 404 here means an empty row in the UI.
 */
function writeCatalogView({ baseDir, type, id, metas, pageSize = 0, extra = "" }) {
  const write = (relPaths, items) => {
    const body = JSON.stringify({ metas: clean(items) }, null, 2) + "\n";
    for (const relPath of relPaths) {
      const file = path.join(baseDir, relPath);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
    console.log(`Wrote ${relPaths[0]} (${items.length} items)`);
  };

  const firstPage = extra
    ? [`catalog/${type}/${id}/${extra}.json`]
    : [`catalog/${type}/${id}.json`];
  const laterPage = (skip) =>
    extra
      ? [
          `catalog/${type}/${id}/${extra}&skip=${skip}.json`,
          `catalog/${type}/${id}/skip=${skip}&${extra}.json`,
        ]
      : [`catalog/${type}/${id}/skip=${skip}.json`];

  if (!pageSize || metas.length <= pageSize) {
    write(firstPage, metas);
    return;
  }

  write(firstPage, metas.slice(0, pageSize));
  for (let skip = pageSize; skip < metas.length; skip += pageSize) {
    write(laterPage(skip), metas.slice(skip, skip + pageSize));
  }
}

/**
 * Write the full catalog plus one view per genre, and report which genres
 * actually ended up with enough titles to be worth offering in the dropdown.
 * Metas are expected to carry `_genres` (display labels).
 */
function writeCatalog({ baseDir, type, id, metas, pageSize = 0, genres = [], minGenreItems = 1 }) {
  writeCatalogView({ baseDir, type, id, metas, pageSize });

  const offered = [];
  for (const genre of genres) {
    const subset = metas.filter((m) => (m._genres || []).includes(genre));
    if (subset.length < minGenreItems) continue;
    writeCatalogView({ baseDir, type, id, metas: subset, pageSize, extra: `genre=${genre}` });
    offered.push(genre);
  }
  return offered;
}

/**
 * Rewrite a manifest's catalog list so the variants and genre dropdowns always
 * match what was actually written. Everything else in the manifest is
 * hand-maintained and left alone.
 */
function writeManifest(manifestPath, catalogs) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.catalogs = catalogs;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${path.basename(manifestPath)} (${catalogs.length} catalogs)`);
}

/** The Stremio catalog entry for one written variant. */
function catalogEntry({ type, id, name, genres }) {
  const extra = [{ name: "skip", isRequired: false }];
  if (genres.length) extra.unshift({ name: "genre", options: genres, isRequired: false });
  return { type, id, name, extra };
}

module.exports = {
  TODAY,
  buildMeta,
  clean,
  byDateDesc,
  META_SORTS,
  resetCatalog,
  writeCatalog,
  writeManifest,
  catalogEntry,
};
