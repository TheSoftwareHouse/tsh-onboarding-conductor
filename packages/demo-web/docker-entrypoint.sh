#!/bin/sh
# Runs from the nginx image's /docker-entrypoint.d before nginx starts: renders /config.js from
# the process environment so one static build serves any BFF origin. Quotes and backslashes are
# stripped from the value so it cannot break out of the JavaScript string.
set -eu

escape() {
  printf '%s' "$1" | sed 's/[\\"]//g'
}

cat > /usr/share/nginx/html/config.js <<CONFIG
window.__ENV__ = {
  VITE_BNPL_BFF_BASE_URL: "$(escape "${VITE_BNPL_BFF_BASE_URL:-}")"
};
CONFIG
