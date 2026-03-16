#!/usr/bin/env bash
set -euo pipefail

# db0 — pre-flight check, version (via changesets), and publish to npm
#
# Workflow:
#   1. Add changesets as you work:
#        npx changeset                    # interactive — picks bump type + description
#
#   2. When ready to release:
#        ./scripts/publish.sh             # preflight → version → build → publish → tag
#        ./scripts/publish.sh --dry-run   # preflight only, no changes
#
# All packages are versioned in lockstep (fixed group in .changeset/config.json).
# Changelogs are auto-generated from changeset descriptions.

BLUE='\033[34m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# All publishable packages in dependency order
PACKAGES=(
  "packages/core"
  "packages/backends/sqlite"
  "packages/backends/postgres"
  "packages/apps/openclaw"
  "packages/apps/claude-code"
  "packages/inspector"
  "packages/cli"
  "packages/benchmark"
)

# ============================================================
# Pre-flight checks
# ============================================================

echo ""
echo -e "${BOLD}  db0 publish — pre-flight checks${RESET}"
echo ""

ERRORS=()

# 1. Pending changesets exist
CHANGESET_COUNT=$(find .changeset -name '*.md' ! -name 'README.md' 2>/dev/null | wc -l | tr -d ' ')
if [[ "$CHANGESET_COUNT" -eq 0 ]]; then
  ERRORS+=("No pending changesets. Run 'npx changeset' to add one before releasing.")
fi
echo -e "  ${GREEN}✓${RESET} ${CHANGESET_COUNT} pending changeset(s)"

# 2. Clean working tree (tracked files only — changesets are allowed)
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  ERRORS+=("Working tree has uncommitted changes. Commit or stash first.")
else
  echo -e "  ${GREEN}✓${RESET} Clean working tree"
fi

# 3. On main branch
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" ]]; then
  ERRORS+=("Not on main branch (currently on '${BRANCH}').")
else
  echo -e "  ${GREEN}✓${RESET} On main branch"
fi

# 4. Up to date with remote
git fetch origin main --quiet 2>/dev/null || true
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main 2>/dev/null || echo "$LOCAL")
if [[ "$LOCAL" != "$REMOTE" ]]; then
  ERRORS+=("Local main is not up to date with origin/main. Pull first.")
else
  echo -e "  ${GREEN}✓${RESET} Up to date with origin"
fi

# 5. npm logged in
NPM_USER=""
if NPM_USER=$(npm whoami 2>/dev/null); then
  echo -e "  ${GREEN}✓${RESET} Logged in to npm as ${BOLD}${NPM_USER}${RESET}"
else
  ERRORS+=("Not logged in to npm. Run 'npm login' first.")
fi

# 6. Build succeeds
echo -ne "  ${DIM}Building...${RESET}\r"
if npm run build --workspaces >/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${RESET} Build succeeded        "
else
  ERRORS+=("Build failed. Run 'npm run build --workspaces' to see errors.")
fi

# 7. Tests pass
echo -ne "  ${DIM}Running tests...${RESET}\r"
TEST_OUTPUT=$(npx vitest run 2>&1)
if echo "$TEST_OUTPUT" | grep -q "Tests.*passed"; then
  PASSED=$(echo "$TEST_OUTPUT" | grep "Tests" | tail -1 | xargs)
  echo -e "  ${GREEN}✓${RESET} ${PASSED}           "
else
  ERRORS+=("Tests failed. Run 'npx vitest run' to see failures.")
fi

# 8. Validate each package
for pkg_dir in "${PACKAGES[@]}"; do
  pkg_json="$ROOT/$pkg_dir/package.json"
  if [[ ! -f "$pkg_json" ]]; then
    ERRORS+=("Missing package.json: $pkg_dir")
    continue
  fi

  name=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$pkg_json','utf8')).name || '')")
  if [[ -z "$name" ]]; then
    ERRORS+=("$pkg_dir: missing 'name' field in package.json")
  fi

  if [[ ! -d "$ROOT/$pkg_dir/dist" ]]; then
    ERRORS+=("$pkg_dir: no dist/ directory")
  fi

  main=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$pkg_json','utf8')).main || '')")
  if [[ -n "$main" && ! -f "$ROOT/$pkg_dir/$main" ]]; then
    ERRORS+=("$pkg_dir: main entry '$main' does not exist")
  fi

  types=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$pkg_json','utf8')).types || '')")
  if [[ -n "$types" && ! -f "$ROOT/$pkg_dir/$types" ]]; then
    ERRORS+=("$pkg_dir: types entry '$types' does not exist")
  fi

  if [[ -f "$ROOT/$pkg_dir/.env" ]]; then
    ERRORS+=("$pkg_dir: .env file found in package directory!")
  fi
done
echo -e "  ${GREEN}✓${RESET} All ${#PACKAGES[@]} packages validated"

# Report errors
if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${RED}${BOLD}Pre-flight failed (${#ERRORS[@]} issue(s)):${RESET}"
  for err in "${ERRORS[@]}"; do
    echo -e "    ${RED}✗${RESET} $err"
  done
  echo ""
  exit 1
fi

echo ""
echo -e "  ${GREEN}${BOLD}All pre-flight checks passed.${RESET}"

# ============================================================
# Dry run — stop here
# ============================================================

if $DRY_RUN; then
  echo ""
  echo -e "  ${YELLOW}${BOLD}Dry run complete.${RESET} No changes made."
  echo ""
  echo -e "  ${DIM}Pending changesets:${RESET}"
  npx changeset status 2>&1 | sed 's/^/    /'
  echo ""
  exit 0
fi

# ============================================================
# Version — consume changesets, bump versions, update changelogs
# ============================================================

echo ""
CURRENT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOT/packages/core/package.json','utf8')).version)")
echo -e "  ${BLUE}Versioning...${RESET} (current: $CURRENT)"
echo ""

npx changeset version 2>&1 | sed 's/^/    /'

NEW_VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$ROOT/packages/core/package.json','utf8')).version)")
echo ""
echo -e "  ${GREEN}✓${RESET} Versioned: ${BOLD}$CURRENT → $NEW_VERSION${RESET}"

# ============================================================
# Rebuild with new version
# ============================================================

echo -ne "  ${DIM}Rebuilding...${RESET}\r"
npm run build --workspaces >/dev/null 2>&1
echo -e "  ${GREEN}✓${RESET} Rebuilt with v$NEW_VERSION     "

# ============================================================
# Commit version bump
# ============================================================

echo -e "  ${BLUE}Committing version bump...${RESET}"
git add -A
git commit -m "release: v$NEW_VERSION" >/dev/null 2>&1
echo -e "  ${GREEN}✓${RESET} Committed"

# ============================================================
# Publish
# ============================================================

echo ""
echo -e "  ${BLUE}Publishing to npm...${RESET}"
echo ""

npx changeset publish 2>&1 | sed 's/^/    /'

# ============================================================
# Git tag + summary
# ============================================================

echo ""

# changeset publish creates tags, but let's ensure we have one
if ! git tag -l "v$NEW_VERSION" | grep -q .; then
  git tag "v$NEW_VERSION"
fi

echo -e "  ${GREEN}${BOLD}Published v$NEW_VERSION${RESET}"
echo ""
echo -e "  ${DIM}Push to remote:${RESET}"
echo -e "    git push && git push --tags"
echo ""
echo -e "  ${DIM}Verify:${RESET}"
echo -e "    npm view @db0-ai/core version"
echo -e "    npx @db0-ai/openclaw status"
echo ""
