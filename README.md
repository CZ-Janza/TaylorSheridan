# Taylor Sheridan — Stremio catalog

A Stremio add-on that adds a **Taylor Sheridan** category to
**Discover → Movies / Series**, listing every movie and show he wrote,
directed or created (Yellowstone, 1883, 1923, Sicario, Wind River,
Hell or High Water…).

The catalog **updates automatically every week** from the
[TMDB](https://www.themoviedb.org) database via GitHub Actions — no manual
work and zero cost (static files served from GitHub Pages).

Add-on URL: `https://cz-janza.github.io/TaylorSheridan/manifest.json`

---

## How it works

```
config.json ──► scripts/generate.js ──► docs/catalog/*.json ──► GitHub Pages ──► Stremio
                     ▲
              TMDB API (person filmography)
                     ▲
        GitHub Action (cron: every Monday)
```

- The script finds Taylor Sheridan on TMDB, downloads his complete
  filmography, filters roles according to `config.json`, and resolves the
  IMDb ID for each title.
- The result is written as static JSON files into `docs/`, which GitHub Pages
  serves as a ready-made Stremio add-on (HTTPS + CORS for free).
- A GitHub Action runs the whole thing every Monday; when a new title appears
  it commits it automatically and the catalog updates for all users.

## Setup (one-time, ~10 minutes)

### 1. Upload the files to the repository

```bash
git clone https://github.com/CZ-Janza/TaylorSheridan.git
# copy the contents of this package here
cd TaylorSheridan
git add -A
git commit -m "Taylor Sheridan Stremio add-on"
git push
```

### 2. Get a TMDB API key (free)

1. Sign up at [themoviedb.org](https://www.themoviedb.org/signup).
2. Profile → **Settings → API** → request a key (Developer, just fill in the
   basics — usage: non-commercial Stremio add-on).
3. Copy the **API Key**. Either the v3 API key or the v4 Read Access Token
   works — the script detects which one you provided.

### 3. Store the key as a secret

In the repository: **Settings → Secrets and variables → Actions →
New repository secret**

- Name: `TMDB_API_KEY`
- Secret: your key

### 4. Enable GitHub Pages

**Settings → Pages → Build and deployment:**

- Source: *Deploy from a branch*
- Branch: `main`, folder `/docs`

The site will shortly be live at `https://cz-janza.github.io/TaylorSheridan/`.

### 5. Run the first generation

**Actions → Update catalog → Run workflow.**

Once it finishes, check that
`https://cz-janza.github.io/TaylorSheridan/catalog/movie/taylor-sheridan-movies.json`
contains movies (a non-empty `metas`).

### 6. Install and test

Open `https://cz-janza.github.io/TaylorSheridan/` and click
**Install in Stremio**, or paste the manifest URL into the add-on search in
Stremio. The "Taylor Sheridan" category will appear in Discover.

### 7. Publish to the official Stremio catalog

Once everything works:

```bash
node scripts/publish.js
```

The script verifies the manifest is reachable and registers the add-on in
Stremio's central catalog (`api.strem.io`). After that the add-on shows up for
all users in the community add-ons section. You only do this once; further
catalog updates propagate automatically (Stremio pulls the catalog from your
URL).

## Tuning behavior (`config.json`)

| Key | Meaning |
|---|---|
| `person.tmdbId` | Hard-code the TMDB person ID (otherwise looked up by name) |
| `includeAllCrewJobs` | `true` = include every crew role regardless of `includeJobs` (default — "anything with his fingerprint") |
| `includeJobs` | Which roles to include when `includeAllCrewJobs: false` |
| `includeActing` | Include acting roles too (default `true`) |
| `includeUnreleased` | Include announced/unfinished projects |
| `excludeTmdbIds` | TMDB IDs of titles you don't want (blacklist) |
| `extraImdbIds` | Manually added titles by IMDb ID (whitelist) |
| `language` / `fallbackLanguage` | Description language (default English) |

After changing `config.json` and pushing, the workflow runs automatically.

**Tip:** the default is maximally broad — every title where Sheridan has any
fingerprint (writing, directing, creating, producing, and acting). To narrow
the catalog, set `includeAllCrewJobs: false` (then only roles from
`includeJobs` count), or `includeActing: false`, or add specific TMDB IDs to
`excludeTmdbIds`.

## Running manually, locally

```bash
TMDB_API_KEY=your_key node scripts/generate.js
```

Requires Node.js 18+, no dependencies to install.

## Repository structure

```
├── config.json                  # what goes into the catalog
├── scripts/
│   ├── generate.js              # catalog generator from TMDB
│   └── publish.js               # one-time publish to Stremio
├── .github/workflows/update.yml # weekly automatic update
└── docs/                        # ← GitHub Pages = the finished add-on
    ├── manifest.json
    ├── index.html               # install page
    └── catalog/
        ├── movie/taylor-sheridan-movies.json
        └── series/taylor-sheridan-series.json
```

## License

MIT. Movie data provided by [TMDB](https://www.themoviedb.org) — this product
uses the TMDB API but is not endorsed or certified by TMDB.
