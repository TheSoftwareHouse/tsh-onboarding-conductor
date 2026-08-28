#!/bin/sh
# Writes /usr/share/nginx/html/config.js from the panel's VITE_* environment variables at
# container start, then chains to the base nginx image's own entrypoint. This is what lets
# the Compose `environment:` block change where the panel points on a restart, with no image
# rebuild (see docs/decisions/0003-admin-panel-runtime-configuration.md and the Proposed
# Solution in specifications/admin-panel-docker-image/admin-panel-docker-image.plan.md).
#
# Installed as /write-config-js.sh, not /docker-entrypoint.sh: the base image
# (nginxinc/nginx-unprivileged) already owns that path for its own entrypoint, which runs the
# /docker-entrypoint.d/ hooks — including 30-tune-worker-processes.sh, which sets
# `worker_processes` from the container's actual CPU quota rather than every host core.
# Overwriting that path would silently disable those hooks, so this script is installed under
# a distinct name and the Dockerfile's ENTRYPOINT points at it instead.
#
# Escaping approach: the runtime stage has no Node, so `node -e` + `JSON.stringify` is not
# available here. Each value is escaped by hand into a JS double-quoted string literal:
# backslashes first (so the quote-escaping step below does not re-escape them), then double
# quotes, then embedded line breaks are split with a POSIX `read` loop and rejoined with the
# literal two-character sequence `\n` — this avoids relying on GNU-sed-only multi-line
# idioms that busybox sed (this image's `/bin/sh` toolchain) does not reliably support.
# Carriage returns are stripped up front so CRLF-pasted values collapse to the same `\n`
# handling as LF values. A value can never break out of the object literal this way.
set -eu

CONFIG_FILE="/usr/share/nginx/html/config.js"

# Escapes a single value for embedding inside a JS double-quoted string literal.
escape_js() {
  value=$(printf '%s' "$1" | tr -d '\r')
  out=""
  first=1
  while IFS= read -r line || [ -n "$line" ]; do
    escaped=$(printf '%s' "$line" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
    if [ "$first" -eq 1 ]; then
      out="$escaped"
      first=0
    else
      out="${out}\\n${escaped}"
    fi
  done <<EOF
$value
EOF
  printf '%s' "$out"
}

# The seven VITE_* keys pinned by the plan's "contract between the two halves" — exactly
# the set already declared in packages/admin-panel/src/vite-env.d.ts. No variable is added
# or renamed here.
vars="VITE_ENGINE_API_BASE_URL VITE_AUTH_ENABLED VITE_SSO_PROVIDER VITE_AZURE_CLIENT_ID VITE_AZURE_TENANT_ID VITE_AZURE_API_SCOPE VITE_AZURE_REDIRECT_URI"

entries=""
for name in $vars; do
  eval "value=\${$name:-}"
  # Unset or empty variables are omitted entirely, rather than written as "", so the panel's
  # runtime-env reader falls through to import.meta.env's existing "missing" handling.
  if [ -n "$value" ]; then
    escaped=$(escape_js "$value")
    entry="  $name: \"$escaped\""
    if [ -n "$entries" ]; then
      entries="$entries,
$entry"
    else
      entries="$entry"
    fi
  fi
done

{
  printf 'window.__ENV__ = {\n'
  if [ -n "$entries" ]; then
    printf '%s\n' "$entries"
  fi
  printf '};\n'
} >"$CONFIG_FILE"

# Chains to the base image's own entrypoint with the same arguments, rather than exec-ing
# them directly, so its /docker-entrypoint.d/ hooks still run before nginx starts. That
# entrypoint only runs the hooks when $1 is "nginx" or "nginx-debug" and otherwise just
# exec's "$@" itself, so `docker run tsh-admin-panel:dod id` (Task 1.2's Definition of Done)
# still runs `id` and exits instead of the entrypoint blocking forever.
exec /docker-entrypoint.sh "$@"
