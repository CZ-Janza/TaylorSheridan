#!/usr/bin/env bash
#
# Nasazení doplňku Taylor Sheridan do repozitáře CZ-Janza/TaylorSheridan.
#
# Předpoklady:
#   - nainstalovaný git a GitHub CLI (gh) — https://cli.github.com
#   - přihlášení:  gh auth login
#   - připravený TMDB API klíč (https://www.themoviedb.org → Settings → API)
#
# Spuštění (z adresáře, kde je tento balíček):
#   bash setup.sh
#
set -euo pipefail

REPO="CZ-Janza/TaylorSheridan"
BRANCH="main"

echo "==> Ověřuji přihlášení k GitHubu…"
gh auth status >/dev/null

echo "==> Commit a push souborů…"
git add -A
git commit -m "Stremio doplněk Taylor Sheridan – automatický katalog z TMDB" || echo "   (nic k commitnutí)"
git push origin "$BRANCH"

echo "==> Uložení TMDB API klíče jako secret (hodnotu zadáte teď)…"
# Klíč se nikam nezaloguje; gh ho pošle přímo do GitHub secrets.
gh secret set TMDB_API_KEY --repo "$REPO"

echo "==> Zapínám GitHub Pages ze složky /docs…"
gh api --method POST "repos/$REPO/pages" \
  -f "source[branch]=$BRANCH" -f "source[path]=/docs" \
  || echo "   (Pages už zřejmě běží – pokračuji)"

echo "==> Spouštím první generování katalogu…"
gh workflow run "Aktualizace katalogu" --repo "$REPO"

cat <<EOF

Hotovo. Za pár minut zkontrolujte:
  - běh workflow:  https://github.com/$REPO/actions
  - naplněný katalog:
      https://cz-janza.github.io/TaylorSheridan/catalog/movie/taylor-sheridan-movies.json
  - instalační stránka:
      https://cz-janza.github.io/TaylorSheridan/

Až vše funguje, publikujte doplněk do Stremia:
  node scripts/publish.js
EOF
