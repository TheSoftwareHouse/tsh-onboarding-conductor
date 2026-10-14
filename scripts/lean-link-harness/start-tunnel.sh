#!/usr/bin/env bash
#
# Puts the engine and the Lean link harness behind one public ngrok domain, split by path:
#
#   /v1/webhooks/*, /v1/health/*   -> the engine (ENGINE_PORT, default 3000): Lean's callbacks and the
#                                     manual script's tunnel check
#   everything else                -> the harness (LEAN_HARNESS_PORT, default 4100), through the
#                                     internal endpoint https://lean-harness.internal
#
# The bank's redirect after consent therefore returns the customer to the harness page they started
# from, over HTTPS, and nothing else of the engine — the admin panel, /v1/admin — is reachable through
# the tunnel.
#
#   NGROK_DOMAIN=<name>.ngrok-free.dev ./scripts/lean-link-harness/start-tunnel.sh
#
# The authtoken is taken from NGROK_AUTHTOKEN, or else read from the agent's existing config file;
# it is passed through the environment and never written to the generated config.

set -euo pipefail

NGROK_DOMAIN=${NGROK_DOMAIN:?set NGROK_DOMAIN to your ngrok static domain, e.g. name.ngrok-free.dev}
NGROK_DOMAIN=${NGROK_DOMAIN#https://}
NGROK_DOMAIN=${NGROK_DOMAIN%/}
ENGINE_PORT=${ENGINE_PORT:-3000}
LEAN_HARNESS_PORT=${LEAN_HARNESS_PORT:-4100}

if [[ -z "${NGROK_AUTHTOKEN:-}" ]]; then
  for candidate in "$HOME/Library/Application Support/ngrok/ngrok.yml" "$HOME/.config/ngrok/ngrok.yml" "$HOME/.ngrok2/ngrok.yml"; do
    if [[ -f "$candidate" ]]; then
      NGROK_AUTHTOKEN=$(awk '/^[[:space:]]*authtoken:/ { print $2; exit }' "$candidate")
      [[ -n "$NGROK_AUTHTOKEN" ]] && break
    fi
  done
fi
[[ -n "${NGROK_AUTHTOKEN:-}" ]] || { echo "no ngrok authtoken found; set NGROK_AUTHTOKEN" >&2; exit 1; }
export NGROK_AUTHTOKEN

CONFIG=$(mktemp -t lean-ngrok)
trap 'rm -f "$CONFIG"' EXIT

cat >"$CONFIG" <<YAML
version: 3
endpoints:
  - name: lean-harness
    url: https://lean-harness.internal
    upstream:
      url: ${LEAN_HARNESS_PORT}
  - name: engine
    url: https://${NGROK_DOMAIN}
    upstream:
      url: ${ENGINE_PORT}
    traffic_policy:
      on_http_request:
        - expressions:
            - "!(req.url.path.startsWith('/v1/webhooks/') || req.url.path.startsWith('/v1/health/'))"
          actions:
            - type: forward-internal
              config:
                url: https://lean-harness.internal
YAML

echo "https://${NGROK_DOMAIN}: /v1/webhooks/*, /v1/health/* -> :${ENGINE_PORT}; everything else -> :${LEAN_HARNESS_PORT}"
exec ngrok start --all --config "$CONFIG" --log stdout --log-format logfmt
