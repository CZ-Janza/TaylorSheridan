# Stremio catalogs — Taylor Sheridan & BBC

Two Stremio add-ons served from one repository. Both add a category to
**Discover → Movies / Series** and both **update automatically every week**
from the [TMDB](https://www.themoviedb.org) database via GitHub Actions — no
manual work and zero cost (static files served from GitHub Pages).

| Add-on | What's in it | Manifest URL |
|---|---|---|
| **Taylor Sheridan** | Every movie and show he wrote, directed or created (Yellowstone, 1883, 1923, Sicario, Wind River, Hell or High Water…) | `https://cz-janza.github.io/TaylorSheridan/manifest.json` |
| **BBC** | Movies and series produced by the BBC and its subsidiaries (BBC Films, BBC Studios, BBC Worldwide, BBC One, BBC Two, CBBC…) | `https://cz-janza.github.io/TaylorSheridan/bbc/manifest.json` |

Install pages: [Taylor Sheridan](https://cz-janza.github.io/TaylorSheridan/) ·
[BBC](https://cz-janza.github.io/TaylorSheridan/bbc/)

---

## How it works

```
config.json     ──► scripts/generate.js     ──► docs/catalog/*.json      ──┐
config.bbc.json ──► scripts/generate-bbc.js ──► docs/bbc/catalog/*.json ──┤
                            ▲                                             │
                     TMDB API                          GitHub Pages ──► Stremio
                            ▲
             GitHub Action (cron: every Monday)
```

- **Taylor Sheridan** follows one *person's* filmography: the script finds him
  on TMDB, downloads his complete credits, filters roles according to
  `config.json`, and resolves the IMDb ID for each title.
- **BBC** follows *production companies and TV networks*: it discovers every
  BBC company on TMDB by name (so subsidiaries are picked up automatically
  rather than hard-coded), verifies the BBC channels, then queries
  `/discover` for everything they produced or aired.
- Both write static JSON into `docs/`, which GitHub Pages serves as ready-made
  Stremio add-ons (HTTPS + CORS for free).
- A GitHub Action runs both every Monday; when a new title appears it commits
  it automatically and the catalogs update for all users.

Titles that have not been released yet are marked **"(upcoming)"** in the name,
with the expected date or production status in the description — Stremio's
metadata add-on has no data for unreleased titles, so this keeps otherwise
blank tiles readable.

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

**Tip:** the default is broad — every title where Sheridan has a crew
fingerprint (writing, directing, creating, producing). Acting-only cameos from
early in his career are excluded via `includeActing: false`; set it back to
`true` if you want them.

## Tuning the BBC catalog (`config.bbc.json`)

| Key | Meaning |
|---|---|
| `companyQueries` | Names searched on TMDB to find BBC companies |
| `companyNamePattern` | Regex a company name must match to count as BBC |
| `extraCompanyIds` / `excludeCompanyIds` | Manually add or drop a TMDB company |
| `candidateNetworkIds` | Network IDs to test (TMDB has no network search) |
| `networkNamePattern` | Regex a network name must match to count as BBC |
| `maxItemsPerType` | How many movies / series to keep (most popular first) |
| `pageSize` | Items per Stremio "skip" page (0 = one big file) |
| `minVoteCount` | Drop titles with fewer TMDB votes than this |
| `sortBy` | `popularity` (default) or `date` |
| `excludeTmdbIds` | TMDB IDs to leave out, per type |

Because the BBC has produced far too much to list in one file, the catalog is
capped at the most popular `maxItemsPerType` titles and split into pages that
Stremio requests as you scroll.

## Running manually, locally

```bash
TMDB_API_KEY=your_key node scripts/generate.js       # Taylor Sheridan
TMDB_API_KEY=your_key node scripts/generate-bbc.js   # BBC
```

Requires Node.js 18+, no dependencies to install.

## Repository structure

```
├── config.json                  # Taylor Sheridan catalog settings
├── config.bbc.json              # BBC catalog settings
├── scripts/
│   ├── lib/
│   │   ├── tmdb.js              # shared TMDB client (auth, retries, concurrency)
│   │   └── catalog.js           # shared meta building + catalog writing
│   ├── generate.js              # Taylor Sheridan generator
│   ├── generate-bbc.js          # BBC generator
│   └── publish.js               # one-time publish to Stremio
├── .github/workflows/update.yml # weekly automatic update (runs both)
└── docs/                        # ← GitHub Pages = the finished add-ons
    ├── manifest.json            # Taylor Sheridan add-on
    ├── index.html               # install page
    ├── catalog/
    │   ├── movie/taylor-sheridan-movies.json
    │   └── series/taylor-sheridan-series.json
    └── bbc/                     # BBC add-on
        ├── manifest.json
        ├── index.html
        └── catalog/
            ├── movie/bbc-movies.json
            └── series/bbc-series.json
```

## License

MIT. Movie data provided by [TMDB](https://www.themoviedb.org) — this product
uses the TMDB API but is not endorsed or certified by TMDB.
