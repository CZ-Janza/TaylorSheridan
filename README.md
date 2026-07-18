# Taylor Sheridan — katalog pro Stremio

Stremio doplněk, který v sekci **Discover → Movies / Series** přidá kategorii
**Taylor Sheridan** se všemi filmy a seriály, které napsal, režíroval nebo
vytvořil (Yellowstone, 1883, 1923, Sicario, Wind River, Hell or High Water…).

Katalog se **aktualizuje automaticky každý týden** z databáze
[TMDB](https://www.themoviedb.org) přes GitHub Actions — bez ruční práce
a s nulovými náklady (statické soubory na GitHub Pages).

Adresa doplňku: `https://cz-janza.github.io/TaylorSheridan/manifest.json`

---

## Jak to funguje

```
config.json ──► scripts/generate.js ──► docs/catalog/*.json ──► GitHub Pages ──► Stremio
                     ▲
              TMDB API (filmografie osoby)
                     ▲
        GitHub Action (cron: každé pondělí)
```

- Skript najde Taylora Sheridana na TMDB, stáhne kompletní filmografii,
  vyfiltruje role podle `config.json` a ke každému titulu zjistí IMDb ID.
- Výsledek zapíše jako statické JSON soubory do `docs/`, které GitHub Pages
  servíruje jako hotový Stremio doplněk (HTTPS + CORS zdarma).
- GitHub Action to celé spouští každé pondělí; když přibyde nový titul,
  sama ho commitne a katalog se aktualizuje všem uživatelům.

## Zprovoznění (jednorázově, cca 10 minut)

### 1. Nahrajte soubory do repozitáře

```bash
git clone https://github.com/CZ-Janza/TaylorSheridan.git
# zkopírujte sem obsah tohoto balíčku
cd TaylorSheridan
git add -A
git commit -m "Stremio doplněk Taylor Sheridan"
git push
```

### 2. Získejte TMDB API klíč (zdarma)

1. Registrace na [themoviedb.org](https://www.themoviedb.org/signup).
2. Profil → **Settings → API** → požádejte o klíč (Developer, stačí vyplnit
   základní údaje — použití: nekomerční Stremio addon).
3. Zkopírujte **API Key** (v3).

### 3. Uložte klíč jako secret

V repozitáři: **Settings → Secrets and variables → Actions →
New repository secret**

- Name: `TMDB_API_KEY`
- Secret: váš klíč

### 4. Zapněte GitHub Pages

**Settings → Pages → Build and deployment:**

- Source: *Deploy from a branch*
- Branch: `main`, složka `/docs`

Za chvíli poběží web na `https://cz-janza.github.io/TaylorSheridan/`.

### 5. Spusťte první generování

**Actions → Aktualizace katalogu → Run workflow.**

Po doběhnutí zkontrolujte, že
`https://cz-janza.github.io/TaylorSheridan/catalog/movie/taylor-sheridan-movies.json`
obsahuje filmy (ne prázdné `metas`).

### 6. Nainstalujte a otestujte

Otevřete `https://cz-janza.github.io/TaylorSheridan/` a klikněte na
**Nainstalovat do Stremia**, nebo vložte adresu manifestu do vyhledávání
doplňků ve Stremiu. Kategorie „Taylor Sheridan" se objeví v Discover.

### 7. Publikace do oficiálního katalogu Stremia

Až vše funguje:

```bash
node scripts/publish.js
```

Skript ověří dostupnost manifestu a zaregistruje doplněk v centrálním
katalogu Stremia (`api.strem.io`). Poté se doplněk zobrazuje všem uživatelům
v komunitní sekci doplňků. Stačí jednou; další aktualizace katalogu už se
propisují automaticky (Stremio si katalog stahuje z vaší adresy).

## Úpravy chování (`config.json`)

| Klíč | Význam |
|---|---|
| `person.tmdbId` | Napevno TMDB ID osoby (jinak se hledá podle jména) |
| `includeAllCrewJobs` | `true` = zahrnout každou roli ve štábu bez ohledu na `includeJobs` (výchozí — „všechno s jeho stopou") |
| `includeJobs` | Které role zahrnout, když je `includeAllCrewJobs: false` |
| `includeActing` | Zahrnout i herecké role (výchozí `true`) |
| `includeUnreleased` | Zahrnout i oznámené/nedokončené projekty |
| `excludeTmdbIds` | TMDB ID titulů, které nechcete (černá listina) |
| `extraImdbIds` | Ručně přidané tituly podle IMDb ID (bílá listina) |
| `language` / `fallbackLanguage` | Jazyk popisů (výchozí čeština s anglickým fallbackem) |

Po změně `config.json` a pushnutí se workflow spustí automaticky.

**Tip:** výchozí nastavení je maximálně široké — každý titul, kde má Sheridan
jakoukoliv stopu (scénář, režie, tvorba, produkce i herectví). Pokud byste
chtěl katalog zúžit, nastavte `includeAllCrewJobs: false` (pak platí jen role
z `includeJobs`), případně `includeActing: false`, nebo přidejte konkrétní
TMDB ID do `excludeTmdbIds`.

## Ruční spuštění lokálně

```bash
TMDB_API_KEY=vas_klic node scripts/generate.js
```

Vyžaduje Node.js 18+, žádné závislosti se neinstalují.

## Struktura repozitáře

```
├── config.json                  # co se má do katalogu zahrnout
├── scripts/
│   ├── generate.js              # generátor katalogu z TMDB
│   └── publish.js               # jednorázová publikace do Stremia
├── .github/workflows/update.yml # týdenní automatická aktualizace
└── docs/                        # ← GitHub Pages = hotový doplněk
    ├── manifest.json
    ├── index.html               # instalační stránka
    └── catalog/
        ├── movie/taylor-sheridan-movies.json
        └── series/taylor-sheridan-series.json
```

## Licence

MIT. Data o filmech poskytuje [TMDB](https://www.themoviedb.org) — tento
produkt používá TMDB API, ale není TMDB schválen ani certifikován.
