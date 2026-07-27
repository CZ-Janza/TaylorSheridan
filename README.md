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
| `catalogVariants` | The catalogs to publish — see below |
| `genreFilter` / `minGenreItems` | Genre dropdown, and how many titles a genre needs |
| `pageSize` | Items per Stremio "skip" page (0 = one file; the list is short) |
| `language` / `fallbackLanguage` | Description language (default English) |

Like the BBC add-on, this one publishes several catalogs — Stremio offers them
in the second dropdown of **Discover**, with a **Genre** dropdown next to it:

| Catalog | What it is |
|---|---|
| Taylor Sheridan Newest | Newest first; announced projects with no date yet come first of all |
| Taylor Sheridan Popular | Most popular on TMDB first |
| Taylor Sheridan Top Rated | Highest rated first |
| Taylor Sheridan Written & Directed | Only titles he wrote, created or directed — no producer-only credits |

The last one shows what a variant's optional `jobs` key does: it narrows the
catalog to titles carrying one of those roles. Since `includeAllCrewJobs` is on
by default, the plain catalogs include everything he produced too, and this is
the way to see just his own writing and directing. Add more the same way, or
delete the ones you don't want — it is only a config entry either way.

Genres come from the filmography records TMDB already returns, so the dropdown
costs no extra API requests.

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
| `maxItemsPerType` | How many movies / series to keep per catalog |
| `pageSize` | Items per Stremio "skip" page (0 = one big file) |
| `catalogVariants` | The catalogs to publish — see *Subfilters* below |
| `genreFilter` | `false` turns the genre dropdown off |
| `minGenreItems` | A genre needs this many titles to be offered |
| `minVoteCount` | Drop titles with fewer TMDB votes than this |
| `minRating` | Drop titles rated below this on TMDB (0 = off) |
| `includeUnreleased` | Include titles that have not aired yet (default `false`) |
| `withTypes` | TMDB show types to keep (series only) |
| `excludeGenreIds` | TMDB genre IDs to drop, per type |
| `excludeNamePattern` | Regex on the title — for what genres don't catch |
| `excludeTmdbIds` | TMDB IDs to leave out, per type |

Because the BBC has produced far too much to list in one file, each catalog is
capped at `maxItemsPerType` titles and split into pages that Stremio requests
as you scroll.

### Subfilters

The add-on publishes the same titles as several catalogs, which Stremio offers
in the second dropdown of **Discover**:

| Catalog | Order |
|---|---|
| BBC Newest | Newest premiere first |
| BBC Popular | Most popular on TMDB first |
| BBC Top Rated | Highest rated first (meaningful thanks to `minVoteCount`) |

Each is discovered separately — "the 500 newest" and "the 500 most popular" are
largely different sets, so every catalog is complete in its own right rather
than a re-shuffle of the same list.

On top of that, every catalog gets a **Genre** dropdown. Since these are static
files, filtering happens at generation time: one file per genre per catalog,
at `catalog/series/bbc-series/genre=Drama.json`. The options in the manifest are
derived from what was actually written, so a genre is only offered when it has
at least `minGenreItems` titles behind it.

Genre labels are deliberately single plain words — TMDB's combined TV genres are
split ("Sci-Fi & Fantasy" becomes both *Sci-Fi* and *Fantasy*), so movie and
series catalogs offer the same list and no label needs URL-encoding in a file
name. The mapping lives in [`scripts/lib/genres.js`](scripts/lib/genres.js).

Stremio's `search` extra is deliberately *not* offered: it would need a file per
possible query, which a static host cannot do.

### Keeping news, sport and game shows out

Most of what the BBC has ever broadcast is not scripted drama, so the catalog is
filtered at the TMDB end — anything rejected there never eats into the
`maxItemsPerType` budget.

**`withTypes` is the main lever.** TMDB classifies every show by type,
independently of its genres:

| | | | |
|---|---|---|---|
| `0` Documentary | `1` News | `2` **Miniseries** ✓ | `3` Reality |
| `4` **Scripted** ✓ | `5` Talk Show | `6` Video | |

`[2, 4]` keeps scripted series and miniseries and drops the rest — including the
programmes no genre describes, such as sport and music shows.

**`excludeGenreIds`** cleans up what the type filter leaves behind. Currently
excluded for series: `10763` News, `10764` Reality/game shows, `10767` Talk,
`99` Documentary, `10762` Kids, `16` Animation. Worth knowing about:

- `10766` **Soap** — EastEnders, Doctors, Holby City, Casualty, Waterloo Road.
  Not excluded; add it if you want them gone.
- `10751` Family and `10768` War & Politics — leave these alone, they would take
  good drama with them.

**`excludeNamePattern`** is the escape hatch for the rest. Umbrella strands like
*Play for Today*, *Screen Two* or *Comedy Playhouse* are perfectly ordinary
scripted drama as far as TMDB is concerned, but nothing watchable sits behind
them; the same goes for companion shows (*Doctor Who Confidential*, *Strictly
Come Dancing: It Takes Two*).

**Tip:** `minVoteCount` is the quietest quality filter — obscure archive
programmes never collect TMDB votes, so raising it thins them out on its own.
Lower it if genuinely new shows are missing: a drama that aired last week may not
have 20 votes yet.

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
│   ├── lib/                     # shared by both generators
│   │   ├── tmdb.js              # TMDB client (auth, retries, concurrency)
│   │   ├── catalog.js           # meta building, sorting, catalog + manifest writing
│   │   └── genres.js            # TMDB genre ids → Stremio dropdown labels
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
