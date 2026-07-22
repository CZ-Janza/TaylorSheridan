/**
 * Shared TMDB client used by the catalog generators.
 *
 * Handles authentication, rate-limit retries and bounded concurrency so the
 * individual generators only deal with catalog logic.
 */

const API_KEY = process.env.TMDB_API_KEY;
if (!API_KEY) {
  console.error("Missing TMDB_API_KEY environment variable.");
  console.error("Locally:  TMDB_API_KEY=xxx node scripts/<generator>.js");
  console.error("On GitHub: Settings → Secrets and variables → Actions → New repository secret");
  process.exit(1);
}

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

// TMDB offers two key types that are easy to mix up:
//  – API Key (v3 auth): short, sent as ?api_key=...
//  – API Read Access Token (v4): long JWT ("eyJ..."), sent in the
//    Authorization: Bearer ... header
// Detect which one we got and use the right method — so it works regardless
// of which key the user put into the secret.
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

  for (let attempt = 1; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(url, options);
    } catch (err) {
      // Transient network hiccup – back off and retry
      if (attempt === 4) throw err;
      await sleep(1000 * attempt);
      continue;
    }
    if (res.status === 429) {
      // rate limit – wait and retry
      await sleep(1500 * attempt);
      continue;
    }
    if (!res.ok) {
      const hint =
        res.status === 401
          ? " (401 = invalid TMDB_API_KEY; make sure the secret contains" +
            " a v3 API Key or a v4 Read Access Token)"
          : "";
      throw new Error(`TMDB ${endpoint} → HTTP ${res.status}${hint}`);
    }
    return res.json();
  }
  throw new Error(`TMDB ${endpoint} → repeated rate limit`);
}

/**
 * Run `fn` over `items` with at most `limit` requests in flight.
 * Keeps the result order identical to the input order.
 */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

module.exports = { tmdb, sleep, mapLimit, IMG };
