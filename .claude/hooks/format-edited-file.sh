#!/usr/bin/env sh
#
# PostToolUse hook: run Prettier on the file Claude just wrote.
#
# The constitution requires `pnpm format:fix` after every change. Doing it per-edited-file keeps the
# working tree Prettier-clean continuously, so the Husky pre-commit `prettier --check` gate never
# fails on formatting alone. The extension list mirrors `lint-staged.config.cjs`.
#
# Deliberately a shell script, not .cjs/.ts: files under .claude/ are ignored by ESLint by default,
# and lint-staged runs `eslint --max-warnings=0` on staged *.cjs, so a .cjs hook would fail the
# pre-commit gate on its own "File ignored by default" warning.
#
# Always exits 0 — a formatting hiccup must never block the edit itself.

set -u

file_path=$(node -e 'try { const input = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(input?.tool_input?.file_path || ""); } catch {}' 2>/dev/null) || exit 0

case "$file_path" in
  *.js | *.cjs | *.mjs | *.ts | *.tsx | *.json | *.md | *.yml | *.yaml)
    cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
    pnpm exec prettier --write "$file_path" >/dev/null 2>&1 || true
    ;;
esac

exit 0
