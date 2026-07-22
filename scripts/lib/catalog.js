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
function buildMeta({ tmdbEntry, imdbId, isMovie, name, overview, date, status, jobs }) {
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
    _date: date || "9999-12-31", // sort helper (Stremio never sees it)
    _jobs: jobs ? [...jobs].sort() : undefined,
  };
}

/** Strip internal underscore fields and undefined values before writing. */
function clean(metas) {
  return metas.map(({ _date, _jobs, ...meta }) =>
    Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined))
  );
}

/** Newest first. */
const byDateDesc = (a, b) => String(b._date).localeCompare(String(a._date));

/**
 * Write a catalog, split into Stremio "skip" pages.
 *
 * Stremio requests /catalog/{type}/{id}.json for the first page and
 * /catalog/{type}/{id}/skip={n}.json for subsequent ones, so a static file per
 * page is enough to make a large catalog scrollable.
 * Pass pageSize = 0 to write everything into a single file.
 */
function writeCatalog({ baseDir, type, id, metas, pageSize = 0 }) {
  const write = (relPath, items) => {
    const file = path.join(baseDir, relPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ metas: items }, null, 2) + "\n");
    console.log(`Wrote ${relPath} (${items.length} items)`);
  };

  if (!pageSize || metas.length <= pageSize) {
    write(`catalog/${type}/${id}.json`, metas);
    return;
  }

  write(`catalog/${type}/${id}.json`, metas.slice(0, pageSize));
  for (let skip = pageSize; skip < metas.length; skip += pageSize) {
    write(`catalog/${type}/${id}/skip=${skip}.json`, metas.slice(skip, skip + pageSize));
  }
}

module.exports = { TODAY, buildMeta, clean, byDateDesc, writeCatalog };
