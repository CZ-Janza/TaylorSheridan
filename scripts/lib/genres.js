/**
 * TMDB genre id → the labels shown in Stremio's "Genre" dropdown.
 *
 * Two things are going on here:
 *
 * 1. Movies and TV use different genre ids for the same idea (28 "Action" vs.
 *    10759 "Action & Adventure"), and the dropdown should look the same for
 *    both catalogs — so both map onto the same labels.
 * 2. TMDB's combined TV genres are split in two ("Sci-Fi & Fantasy" becomes
 *    both "Sci-Fi" and "Fantasy"), which matches how Stremio's own catalogs
 *    list them and keeps every label a single plain word.
 *
 * Labels must stay free of characters that need URL-encoding: they end up in
 * file names like `catalog/series/bbc-series/genre=Drama.json`.
 */
const GENRE_LABELS = {
  // Shared between movies and TV
  16: ["Animation"],
  35: ["Comedy"],
  80: ["Crime"],
  99: ["Documentary"],
  18: ["Drama"],
  10751: ["Family"],
  9648: ["Mystery"],

  // TV only
  10759: ["Action", "Adventure"],
  10762: ["Kids"],
  10763: ["News"],
  10764: ["Reality"],
  10765: ["Sci-Fi", "Fantasy"],
  10766: ["Soap"],
  10767: ["Talk"],
  10768: ["War"],

  // Movies only
  12: ["Adventure"],
  14: ["Fantasy"],
  27: ["Horror"],
  28: ["Action"],
  36: ["History"],
  37: ["Western"],
  53: ["Thriller"],
  878: ["Sci-Fi"],
  10402: ["Music"],
  10749: ["Romance"],
  10752: ["War"],
};

/** Display labels for a list of TMDB genre ids. */
function genreLabelsFromIds(ids) {
  const out = new Set();
  for (const id of ids || []) {
    for (const label of GENRE_LABELS[id] || []) out.add(label);
  }
  return [...out];
}

/**
 * Display labels for a TMDB detail response's `genres` array. Summary records
 * (search results, credits) carry plain `genre_ids` instead — use
 * `genreLabelsFromIds` for those and save the extra request.
 */
function genreLabels(genres) {
  return genreLabelsFromIds((genres || []).map((g) => g.id));
}

/** Every label that could ever be produced, alphabetically. */
const ALL_GENRE_LABELS = [...new Set(Object.values(GENRE_LABELS).flat())].sort();

module.exports = { GENRE_LABELS, ALL_GENRE_LABELS, genreLabels, genreLabelsFromIds };
