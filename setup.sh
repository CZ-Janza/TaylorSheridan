#!/usr/bin/env bash
#
# Deploy the Taylor Sheridan add-on to the CZ-Janza/TaylorSheridan repository.
#
# Requirements:
#   - git and the GitHub CLI (gh) installed — https://cli.github.com
#   - signed in:  gh auth login
#   - a TMDB API key ready (https://www.themoviedb.org → Settings → API)
#
# Run (from the directory containing this package):
#   bash setup.sh
#
set -euo pipefail

REPO="CZ-Janza/TaylorSheridan"
BRANCH="main"

echo "==> Checking GitHub sign-in…"
gh auth status >/dev/null

echo "==> Committing and pushing files…"
git add -A
git commit -m "Taylor Sheridan Stremio add-on – automatic catalog from TMDB" || echo "   (nothing to commit)"
git push origin "$BRANCH"

echo "==> Storing the TMDB API key as a secret (you enter the value now)…"
# The key is never logged; gh sends it straight to GitHub secrets.
gh secret set TMDB_API_KEY --repo "$REPO"

echo "==> Enabling GitHub Pages from the /docs folder…"
gh api --method POST "repos/$REPO/pages" \
  -f "source[branch]=$BRANCH" -f "source[path]=/docs" \
  || echo "   (Pages is probably already enabled – continuing)"

echo "==> Triggering the first catalog generation…"
gh workflow run "Update catalog" --repo "$REPO"

cat <<EOF

Done. In a few minutes, check:
  - the workflow run:  https://github.com/$REPO/actions
  - the populated catalog:
      https://cz-janza.github.io/TaylorSheridan/catalog/movie/taylor-sheridan-movies.json
  - the install page:
      https://cz-janza.github.io/TaylorSheridan/

Once everything works, publish the add-on to Stremio:
  node scripts/publish.js
EOF
