#!/usr/bin/env bash
#
# Drives the lean-ksa-typed onboarding (workflows/fixtures/lean-ksa-typed.workflow.json) end to end
# against a local stack and the Lean Technologies KSA SANDBOX: collect_bank_account, then
# verify_iban (lean_iban_verification), then bank_connect (lean_bank_data, parked until Lean's
# webhook arrives), then affordability_decision, ending on approved.
#
# The engine never hands a client a widget token, so the bank link is made by hand in a small
# dev-only page (scripts/lean-link-harness) that this script starts: you log in to a Lean mock bank
# there, Lean calls the engine's webhook through your tunnel, and the parked step resumes.
#
# Before the first run:
#
#   1. Credentials. Copy the sandbox app's client id, client secret and webhook secret into the
#      gitignored .env.lean.local at the repository root (it is read, never printed):
#        LEAN_CLIENT_ID=...          the portal's "app token"
#        LEAN_CLIENT_SECRET=...
#        LEAN_WEBHOOK_SECRET=...     the signing secret of the portal's webhook
#        LEAN_AUTH_BASE_URL=https://auth.sandbox.sa.leantech.me
#        LEAN_API_BASE_URL=https://sandbox.sa.leantech.me
#      The engine reads the credentials as connector settings, not as env vars: this script PUTs
#      them for both connector ids (lean_iban_verification, lean_bank_data). That route is open
#      while ADMIN_AUTH_ENABLED=false (the .env.dist default); with admin auth on, use the admin
#      panel's Connectors page instead, and rerun with SKIP_SETTINGS=1 (the PUT here fails early).
#   2. The stack, with the fixtures loaded. Fixtures are skipped only when NODE_ENV=production, so
#      the default local stack serves lean-ksa-typed:   pnpm stack:up
#   3. The path-split ngrok tunnel, with its URL passed as TUNNEL (required: Lean's webhook has to
#      reach the engine, and the bank has to return the customer to the harness over HTTPS):
#        NGROK_DOMAIN=<name>.ngrok-free.dev ./scripts/lean-link-harness/start-tunnel.sh
#      It sends /v1/webhooks/* and /v1/health/* to the engine and every other path to the harness.
#   4. In the Lean portal, set the application's webhook URL to
#        <TUNNEL>/v1/webhooks/lean_bank_data/callback
#      The script prints the exact URL. Lean signs deliveries with the webhook secret from step 1.
#   5. A mock-bank login user from the portal's sandbox settings. They are never stored here: you
#      type them into the widget.
#
#   TUNNEL=https://your-domain.ngrok-free.app ./scripts/run-ksa-lean-manual-test.sh
#
# The run stops at the harness and waits for the webhook. If the step is still parked after
# WEBHOOK_WINDOW seconds it offers POST /v1/onboardings/:id/pending-connector/reconcile, which asks
# Lean for the data directly. AUTO_CONFIRM=1 skips the Enter gate and reconciles without asking.
#
# After the webhook the onboarding waits on affordability_decision, which routes only on a client
# submit; the poll submits {} once and prints which branch the decision took.
#
# A verdict routed to manual_review is NOT approved by default: the run stops and reports it, because
# approving by hand and then asserting "approved" would not show that the income fields drove the
# decision. AUTO_APPROVE_REVIEW=1 approves the review automatically; the run then ends approved via
# the review path, and says so.
#
# Every setting below is read from the environment first and falls back to the value written into
# the block, so editing the file and exporting a variable both work.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

# --- fill these in ------------------------------------------------------------

# The public URL of the tunnel to the engine. Required, never prompted for, and passed inline
# because ngrok free domains and cloudflared URLs change: TUNNEL='https://x.example' ./scripts/...
TUNNEL=${TUNNEL:-''}

# Lean's documented sandbox pair: this IBAN belongs to this national ID in the sandbox's
# confirmation-of-payee service. Public documentation values, not credentials.
IBAN=${IBAN:-SA2810000011100000461309}
NATIONAL_ID=${NATIONAL_ID:-1106972886}

# --- the rest rarely changes --------------------------------------------------

API=${API:-http://localhost:3000}
WORKFLOW_ID=lean-ksa-typed
LEAN_ENV_FILE=${LEAN_ENV_FILE:-$REPO_ROOT/.env.lean.local}
LEAN_HARNESS_PORT=${LEAN_HARNESS_PORT:-4100}
HARNESS_SCRIPT=${HARNESS_SCRIPT:-$SCRIPT_DIR/lean-link-harness/server.cjs}
HARNESS_START_TIMEOUT=${HARNESS_START_TIMEOUT:-15}
HARNESS_URL=http://127.0.0.1:$LEAN_HARNESS_PORT

# How long the whole run may wait for a terminal state, and how long a parked bank_connect waits
# for the webhook before the reconcile is offered.
LEAN_TIMEOUT=${LEAN_TIMEOUT:-900}
WEBHOOK_WINDOW=${WEBHOOK_WINDOW:-90}
ASK_TIMEOUT=${ASK_TIMEOUT:-20}

# Set to 1 to skip the Enter gate and reconcile without asking.
AUTO_CONFIRM=${AUTO_CONFIRM:-''}

# Set to 1 to approve a manual_review verdict instead of stopping on it.
AUTO_APPROVE_REVIEW=${AUTO_APPROVE_REVIEW:-''}
# How long the harness stays up after the verdict under AUTO_CONFIRM=1, so the bank's redirect and
# the page's last polls still find it; without AUTO_CONFIRM the run waits for Enter instead.
HARNESS_LINGER=${HARNESS_LINGER:-120}

ID=''
PATH_TAKEN='approve (no manual review)'
HARNESS_PID=''

tmp_body=$(mktemp)
HARNESS_LOG=$(mktemp)

# --- output -------------------------------------------------------------------

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; RESET=''
fi

section() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
info() { printf '    %s%s%s\n' "$DIM" "$*" "$RESET"; }
ok() { printf '    %s%s%s\n' "$GREEN" "$*" "$RESET"; }
die() { printf '\n%sFAILED: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# Stop the harness this run started. Its log outlives the run; it holds hosts, statuses and codes
# only, never a token.
cleanup() {
  rm -f "$tmp_body"

  if [[ -n "$HARNESS_PID" ]] && kill -0 "$HARNESS_PID" 2>/dev/null; then
    kill "$HARNESS_PID" 2>/dev/null || true
    wait "$HARNESS_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- helpers ------------------------------------------------------------------

# pause <what>: hold the run until Enter is pressed. An input with nothing left to give reads as
# EOF and continues rather than stalling on an Enter nobody can press.
pause() {
  local answer='' fd=0 tty_open=false

  if [[ "$AUTO_CONFIRM" == 1 ]]; then
    info "AUTO_CONFIRM=1 — going on to $1 without waiting"

    return 0
  fi

  if { exec 3< /dev/tty; } 2>/dev/null; then
    fd=3
    tty_open=true
  fi

  printf '    %sPress Enter to %s%s' "$BOLD" "$1" "$RESET"
  read -r -u "$fd" answer || printf '\n'
  if [[ "$tty_open" == true ]]; then
    exec 3<&-
  fi
}

# ask_yes <prompt>: true when y/Y is typed within ASK_TIMEOUT; a timeout or anything else is no.
ask_yes() {
  local answer='' fd=0 tty_open=false

  if [[ "$AUTO_CONFIRM" == 1 ]]; then
    return 0
  fi

  if { exec 3< /dev/tty; } 2>/dev/null; then
    fd=3
    tty_open=true
  fi

  printf '    %s%s [y/N, %ss]: %s' "$BOLD" "$1" "$ASK_TIMEOUT" "$RESET"
  read -r -t "$ASK_TIMEOUT" -u "$fd" answer || printf '\n'
  if [[ "$tty_open" == true ]]; then
    exec 3<&-
  fi

  [[ "$answer" == y || "$answer" == Y ]]
}

state() {
  curl -sS --max-time 15 "$API/v1/onboardings/$ID/state"
}

current_step() {
  state | jq -r '.currentStep // "null"'
}

show_state() {
  state | jq -c '{status,currentStep}'
}

# expect_step <step>: fail unless the onboarding sits on <step> ("null" for a finished run).
expect_step() {
  local want=$1 got
  got=$(current_step)
  [[ "$got" == "$want" ]] || die "expected step '$want', got '$got' — $(show_state)"
  ok "on $want"
}

# post_submit <json> <expected-next-step>: POST /submit, assert where it landed. A submit runs the
# connector chain inline, so the timeout is generous.
post_submit() {
  local body=$1 want=$2
  curl -sS --max-time 90 -X POST "$API/v1/onboardings/$ID/submit" \
    -H 'content-type: application/json' -d "$body" | jq -c '{status,currentStep,rejectionReason}'
  expect_step "$want"
}

# put_connector_settings <connectorId> <jq-object-expression>: store the connector's settings. The
# body is built by jq from the environment and piped to curl, so no secret reaches a process's
# argument list or this script's output.
put_connector_settings() {
  local connector=$1 settings=$2 status

  status=$(jq -n "{settings: $settings}" |
    curl -sS --max-time 15 -o "$tmp_body" -w '%{http_code}' -X PUT "$API/v1/admin/connectors/$connector" \
      -H 'content-type: application/json' --data-binary @-)

  case "$status" in
    200 | 201 | 204) ok "settings stored for $connector (HTTP $status)" ;;
    401 | 403 | 503)
      die "storing settings for $connector answered HTTP $status — admin auth is on; set the credentials on the admin panel's Connectors page and rerun with SKIP_SETTINGS=1"
      ;;
    *) die "storing settings for $connector answered HTTP $status: $(head -c 200 "$tmp_body")" ;;
  esac
}

# --- 1. inputs ----------------------------------------------------------------

section "1. Checking inputs"

command -v curl >/dev/null || die "curl is not installed"
command -v jq >/dev/null || die "jq is not installed"
command -v node >/dev/null || die "node is not installed — it is needed to run $HARNESS_SCRIPT"
[[ -f "$HARNESS_SCRIPT" ]] || die "no harness to start: $HARNESS_SCRIPT is missing"

if [[ -f "$LEAN_ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$LEAN_ENV_FILE"
  set +a
  ok "credentials read from $LEAN_ENV_FILE"
else
  info "$LEAN_ENV_FILE not found — taking LEAN_* from the environment"
fi

for name in LEAN_CLIENT_ID LEAN_CLIENT_SECRET LEAN_WEBHOOK_SECRET LEAN_AUTH_BASE_URL LEAN_API_BASE_URL; do
  [[ -n "${!name:-}" ]] || die "$name is not set — see the header of this script, step 1"
done

[[ -n "$TUNNEL" ]] || die "TUNNEL is not set — start ngrok or cloudflared and run: TUNNEL=https://<tunnel> $0"
TUNNEL=${TUNNEL%/}

# --- 2. smoke test ------------------------------------------------------------

section "2. Smoke test"

curl -sS --max-time 5 "$API/v1/health/live" >/dev/null || die "the engine is not answering on $API — run pnpm stack:up"
ok "engine is up"

curl -fsS --max-time 10 "$TUNNEL/v1/health/live" >/dev/null \
  || die "the tunnel $TUNNEL does not reach the engine's /v1/health/live — Lean's webhook could not either"
ok "tunnel reaches the engine"

printf '    %sThe Lean portal webhook URL must be:%s\n' "$BOLD" "$RESET"
printf '      %s/v1/webhooks/lean_bank_data/callback\n' "$TUNNEL"
info "(POST only: opening it in a browser answers 404 or 405, which is expected)"

workflow_status=$(curl -sS --max-time 10 -o "$tmp_body" -w '%{http_code}' "$API/v1/admin/workflows/$WORKFLOW_ID")
case "$workflow_status" in
  200) ok "workflow $WORKFLOW_ID is loaded (version $(jq -r '.workflowVersion' "$tmp_body"))" ;;
  401 | 403 | 503) info "admin auth is on (HTTP $workflow_status) — cannot confirm the workflow is loaded; call 1 will tell" ;;
  *) die "workflow $WORKFLOW_ID is not loaded (HTTP $workflow_status) — fixtures are skipped when NODE_ENV=production" ;;
esac

# --- 3. connector settings ----------------------------------------------------

section "3. Connector settings"

if [[ "${SKIP_SETTINGS:-}" == 1 ]]; then
  info "SKIP_SETTINGS=1 — leaving the stored connector settings as they are"
else
  put_connector_settings lean_iban_verification '{clientId: env.LEAN_CLIENT_ID, clientSecret: env.LEAN_CLIENT_SECRET}'
  put_connector_settings lean_bank_data \
    '{clientId: env.LEAN_CLIENT_ID, clientSecret: env.LEAN_CLIENT_SECRET, callbackSigningSecret: env.LEAN_WEBHOOK_SECRET}'
fi

# --- 4. create ----------------------------------------------------------------

section "4. Call 1 — create the onboarding"

ID=$(curl -sS --max-time 15 -X POST "$API/v1/onboardings" -H 'content-type: application/json' \
  -d "{\"workflowId\":\"$WORKFLOW_ID\"}" | jq -r '.onboardingId // empty')
[[ -n "$ID" ]] || die "the engine did not return an onboardingId"
ok "onboardingId=$ID"
expect_step collect_bank_account

# --- 5. IBAN ------------------------------------------------------------------

section "5. Calls 2-3 — the IBAN and national ID, then the ownership check"

post_submit "{\"iban\":\"$IBAN\",\"nationalId\":\"$NATIONAL_ID\"}" verify_iban

# verify_iban declares no fields: submitting it runs lean_iban_verification against the pair above.
post_submit '{}' bank_connect

# --- 6. harness ---------------------------------------------------------------

section "6. The Lean widget"

info "starting $HARNESS_SCRIPT on $HARNESS_URL"
# The tunnel (scripts/lean-link-harness/start-tunnel.sh) forwards every non-/v1 path on its domain
# to the harness, so the harness also accepts that one host.
ENGINE_URL=$API LEAN_HARNESS_PORT=$LEAN_HARNESS_PORT LEAN_HARNESS_PUBLIC_HOST=${TUNNEL#https://} \
  node "$HARNESS_SCRIPT" >"$HARNESS_LOG" 2>&1 &
HARNESS_PID=$!

waited=0
until curl -sS --max-time 2 -o /dev/null "$HARNESS_URL/" 2>/dev/null; do
  kill -0 "$HARNESS_PID" 2>/dev/null || { cat "$HARNESS_LOG" >&2; die "the harness exited — see above"; }
  (( waited < HARNESS_START_TIMEOUT )) || die "the harness did not answer on $HARNESS_URL within ${HARNESS_START_TIMEOUT}s — see $HARNESS_LOG"
  sleep 1
  waited=$((waited + 1))
done
ok "harness is listening (pid $HARNESS_PID), log: $HARNESS_LOG"

printf '    %sOpen this page, press "Connect bank", and log in with a Lean mock-bank user:%s\n' "$BOLD" "$RESET"
# Lean's KSA mock banks authenticate by redirect and refuse a plain-http loopback return address,
# so the page is opened through the tunnel: the bank then returns the customer to it over HTTPS.
# This needs the path-split tunnel from scripts/lean-link-harness/start-tunnel.sh.
printf '      %s/?onboardingId=%s\n' "$TUNNEL" "$ID"
info "pressing the button creates the Lean customer and parks bank_connect on it"
pause "start watching for the verdict"

# --- 7. verdict ---------------------------------------------------------------

section "7. Waiting for Lean's webhook"

info "polling for up to ${LEAN_TIMEOUT}s; a manual_review verdict stops the run unless AUTO_APPROVE_REVIEW=1"

deadline=$((SECONDS + LEAN_TIMEOUT))
decision_submitted=0
window_end=$((SECONDS + WEBHOOK_WINDOW))
while :; do
  snapshot=$(state)
  step=$(printf '%s' "$snapshot" | jq -r '.currentStep // "null"')

  case "$step" in
    null) break ;;
    manual_review)
      printf '%s' "$snapshot" | jq -c '{status,currentStep,rejectionReason,step}'
      [[ "$AUTO_APPROVE_REVIEW" == 1 ]] \
        || die "the decision routed to manual_review, so the income fields did not produce an automatic approval — state above. Set AUTO_APPROVE_REVIEW=1 to approve it by hand and finish the run"
      PATH_TAKEN='review (manual_review approved by hand, AUTO_APPROVE_REVIEW=1)'
      info "verdict routed to manual_review — approving (AUTO_APPROVE_REVIEW=1)"
      curl -sS --max-time 30 -X POST "$API/v1/onboardings/$ID/review/approve" | jq -c '{status,currentStep}'
      ;;
    affordability_decision)
      # The callback settles bank_connect, but a decision step routes only on a client submit.
      printf '%s' "$snapshot" | jq -c '{status,currentStep}'
      if (( decision_submitted == 0 )); then
        info "bank_connect resumed — submitting {} to route affordability_decision"
        decision_submitted=1
        routed=$(curl -sS --max-time 90 -X POST "$API/v1/onboardings/$ID/submit" \
          -H 'content-type: application/json' -d '{}')
        printf '%s' "$routed" | jq -c '{status,currentStep,rejectionReason}'
        routed_step=$(printf '%s' "$routed" | jq -r '.currentStep // "null"')
        case "$routed_step" in
          null) info "decision branch taken: approve" ;;
          manual_review) info "decision branch taken: review" ;;
          *) info "decision routed to $routed_step" ;;
        esac
      fi
      ;;
    bank_connect)
      printf '%s' "$snapshot" | jq -c '{status,currentStep}'

      if (( SECONDS >= window_end )); then
        if ask_yes "Still parked after ${WEBHOOK_WINDOW}s. Ask Lean for the data via reconcile?"; then
          curl -sS --max-time 90 -X POST "$API/v1/onboardings/$ID/pending-connector/reconcile" \
            | jq -c '{outcome, status: .onboarding.status, currentStep: .onboarding.currentStep}'
        fi
        window_end=$((SECONDS + WEBHOOK_WINDOW))
      fi
      ;;
    *) printf '%s' "$snapshot" | jq -c '{status,currentStep}' ;;
  esac

  (( SECONDS < deadline )) || die "still on '$step' after ${LEAN_TIMEOUT}s — check the webhook URL and secret in the Lean portal, and $HARNESS_LOG"
  sleep 5
done

final=$(show_state)
printf '\n%s%s%s\n' "$GREEN" "$final" "$RESET"
[[ "$(state | jq -r '.status')" == "approved" ]] || die "the run did not end approved — $final"
ok "run complete: onboarding $ID is approved — path taken: $PATH_TAKEN"

# The customer may still be on their way back from the bank to the harness page.
if [[ "$AUTO_CONFIRM" == 1 ]]; then
  info "keeping the harness up for ${HARNESS_LINGER}s so the page and the bank's redirect still reach it"
  sleep "$HARNESS_LINGER"
else
  pause "stop the harness"
fi
