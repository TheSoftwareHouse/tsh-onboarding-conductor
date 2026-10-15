#!/usr/bin/env bash
#
# Drives the UK BNPL credit check end to end against a local stack and the real Algoan sandbox:
# configure the algoan_credit connector, (re)create the two Algoan webhook subscriptions for the
# tunnel, start an onboarding on uk-bnpl-credit-check-algoan-local, submit the applicant and the
# consent, upload a date-re-based persona as the bankData document, submit it and wait for the
# webhook-driven result. Modelled on run-eu-b2c-kyc-manual-test-veriff.sh (Enter gates,
# AUTO_CONFIRM, TUNNEL, API).
#
# Usage:
#   ALGOAN_CLIENT_ID=... ALGOAN_CLIENT_SECRET=... ALGOAN_CALLBACK_SIGNING_SECRET=$(openssl rand -hex 32) \
#   TUNNEL=https://<random>.trycloudflare.com \
#     ./scripts/run-uk-bnpl-manual-test-algoan.sh [--persona sherlock_holmes|james_watson|james_moriarty]
#
# Credentials come from the three environment variables above. The engine's admin API masks
# connector secrets, so they cannot be read back from it; the script writes them to the connector
# with PUT /v1/admin/connectors/algoan_credit (after asking) and hands the same environment to
# scripts/algoan-subscriptions.cjs. Nothing is echoed. Without TUNNEL the webhook leg is skipped
# and the run falls back to the admin reconcile route once CREDIT_TIMEOUT has passed.
#
# Expected: sherlock_holmes -> approved (965), james_watson -> review (598), james_moriarty -> declined (362).
#
# Settings (environment): API (http://localhost:3000), TUNNEL, AUTO_CONFIRM=1, CREDIT_TIMEOUT (300 s),
# STORAGE_S3_PORT (3900), WORKFLOW_ID, WORKFLOW_FILE, APPLICANT_JSON, CONSENT_JSON.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)

API=${API:-http://localhost:3000}
TUNNEL=${TUNNEL:-''}
CREDIT_TIMEOUT=${CREDIT_TIMEOUT:-300}
AUTO_CONFIRM=${AUTO_CONFIRM:-''}
STORAGE_S3_PORT=${STORAGE_S3_PORT:-3900}
WORKFLOW_ID=${WORKFLOW_ID:-uk-bnpl-credit-check-algoan-local}
WORKFLOW_FILE=${WORKFLOW_FILE:-$REPO_ROOT/workflows/built-in/uk-bnpl-credit-check-algoan.workflow.json}
PERSONA=sherlock_holmes
PERSONAS_DIR=${PERSONAS_DIR:-$REPO_ROOT/packages/demo-bff/personas/en}
CALLBACK_PATH=/v1/webhooks/algoan_credit/callback

while (( $# > 0 )); do
  case "$1" in
    --persona) PERSONA=${2:-}; shift 2 ;;
    -h | --help) sed -n '2,24p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 1 ;;
  esac
done

ID=''
DOCUMENT_ID=''
tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; RESET=''
fi

section() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$RESET"; }
info() { printf '    %s%s%s\n' "$DIM" "$*" "$RESET"; }
ok() { printf '    %s%s%s\n' "$GREEN" "$*" "$RESET"; }
die() { printf '\n%sFAILED: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

file_size() { stat -f%z "$1" 2>/dev/null || stat -c%s "$1"; }

# pause <what>: hold the run until Enter is pressed. EOF (no input) continues.
pause() {
  local answer=''
  if [[ "$AUTO_CONFIRM" == 1 ]]; then
    info "AUTO_CONFIRM=1 - going on to $1 without waiting"
    return 0
  fi
  printf '    %sPress Enter to %s%s' "$BOLD" "$1" "$RESET"
  if [[ -r /dev/tty ]]; then read -r answer < /dev/tty || printf '\n'; else read -r answer || printf '\n'; fi
}

state() { curl -sS "$API/v1/onboardings/$ID/state"; }
current_step() { state | jq -r '.currentStep // "null"'; }

# post_submit <json> <expected-next-step>, gated by Enter through submit().
post_submit() {
  local body=$1 want=$2 got
  curl -sS -X POST "$API/v1/onboardings/$ID/submit" -H 'content-type: application/json' -d "$body" | jq -c '{status,currentStep}'
  got=$(current_step)
  [[ "$got" == "$want" ]] || die "expected step '$want', got '$got' - $(state | jq -c '{status,currentStep}')"
  ok "on $want"
}
submit() { pause "submit $(current_step)"; post_submit "$@"; }

# upload_document <field> <contentType> <path>: reserve, send the bytes, complete. Sets $DOCUMENT_ID.
upload_document() {
  local field=$1 content_type=$2 path=$3 reserve upload_url status
  local -a form=()

  info "reserving $field ($content_type, $(file_size "$path") bytes)"
  reserve=$(curl -sS -X POST "$API/v1/onboardings/$ID/documents" -H 'content-type: application/json' \
    -d "{\"field\":\"$field\",\"contentType\":\"$content_type\",\"sizeBytes\":$(file_size "$path")}")
  DOCUMENT_ID=$(printf '%s' "$reserve" | jq -r '.documentId // empty')
  upload_url=$(printf '%s' "$reserve" |
    jq -r --arg port "$STORAGE_S3_PORT" '.upload.url // empty | sub("//garage:3900"; "//localhost:" + $port)')
  [[ -n "$DOCUMENT_ID" && -n "$upload_url" ]] || die "could not reserve $field: $reserve"

  while IFS= read -r entry; do form+=(-F "$entry"); done \
    < <(printf '%s' "$reserve" | jq -r '.upload.fields | to_entries[] | "\(.key)=\(.value)"')

  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$upload_url" "${form[@]}" -F "file=@$path")
  [[ "$status" == 204 || "$status" == 200 ]] || die "upload of $field answered HTTP $status"
  ok "stored (HTTP $status), documentId=$DOCUMENT_ID"
  curl -sS -X POST "$API/v1/onboardings/$ID/documents/$DOCUMENT_ID/complete" \
    -H 'content-type: application/json' -d '{}' | jq -c '{documentId}'
}

# --- 1. inputs ----------------------------------------------------------------

section "1. Checking inputs"

for tool in curl jq node; do command -v "$tool" >/dev/null || die "$tool is not installed"; done
PERSONA_FILE=$PERSONAS_DIR/$PERSONA.json
[[ -f "$PERSONA_FILE" ]] || die "no persona file $PERSONA_FILE (sherlock_holmes, james_watson or james_moriarty)"
ok "persona $PERSONA"
: "${ALGOAN_CLIENT_ID:?set ALGOAN_CLIENT_ID}" "${ALGOAN_CLIENT_SECRET:?set ALGOAN_CLIENT_SECRET}" \
  "${ALGOAN_CALLBACK_SIGNING_SECRET:?set ALGOAN_CALLBACK_SIGNING_SECRET (e.g. openssl rand -hex 32)}"
export ALGOAN_CLIENT_ID ALGOAN_CLIENT_SECRET ALGOAN_CALLBACK_SIGNING_SECRET
ok "Algoan credentials present in the environment (not shown)"

# The applicant and consent bodies: read from the workflow file when it exists, else the defaults
# below (overridable through APPLICANT_JSON / CONSENT_JSON). A consents entry { key, acknowledgement }
# is submitted as <key>Version = version plus <key><Acknowledgement> = true (e.g. termsVersion,
# termsAccepted), which is what the compiled consents step requires.
APPLICANT_JSON=${APPLICANT_JSON:-'{"firstName":"Sherlock","lastName":"Holmes","email":"sherlock.holmes@example.com"}'}
consent_default='{"creditCheckConsent":true}'
if [[ -n "${CONSENT_JSON:-}" ]]; then
  info "consent body from CONSENT_JSON"
elif [[ -f "$WORKFLOW_FILE" ]]; then
  CONSENT_JSON=$consent_default
  consent_from_file=$(jq -c '
    [.steps[] | select(.name == "credit_consent")
      | (.config.consents // [.include[]? | select(.type == "consents") | .config.consents[]?])[]?
      | select(.required != false)
      | ({key: (.key + "Version"), value: .version},
         {key: (.key + (.acknowledgement | .[0:1] | ascii_upcase) + (.acknowledgement | .[1:])), value: true})]
    | if length == 0 then empty else from_entries end' "$WORKFLOW_FILE" 2>/dev/null || true)
  if [[ -n "$consent_from_file" ]]; then CONSENT_JSON=$consent_from_file; fi
  ok "consent fields from $(basename "$WORKFLOW_FILE"): $CONSENT_JSON"
else
  CONSENT_JSON=$consent_default
  info "$WORKFLOW_FILE not found - using default field names; override with APPLICANT_JSON / CONSENT_JSON"
  info "applicant=$APPLICANT_JSON consent=$CONSENT_JSON"
fi

# --- 2. smoke test ------------------------------------------------------------

section "2. Smoke test"

curl -sS --max-time 5 "$API/v1/health/live" >/dev/null || die "the engine is not answering on $API - run pnpm stack:up"
ok "engine is up"
if [[ -n "$TUNNEL" ]]; then
  curl -sS --max-time 10 "$TUNNEL/v1/health/live" >/dev/null || die "the tunnel $TUNNEL does not reach the engine"
  ok "tunnel reaches the engine"
else
  info "TUNNEL not set - skipping the tunnel check and the subscriptions; the result will need reconcile"
fi

# --- 3. connector settings ----------------------------------------------------

section "3. Connector settings (PUT /v1/admin/connectors/algoan_credit)"

pause "store clientId / clientSecret / callbackSigningSecret on the connector"
status=$(jq -n --arg a "$ALGOAN_CLIENT_ID" --arg b "$ALGOAN_CLIENT_SECRET" --arg c "$ALGOAN_CALLBACK_SIGNING_SECRET" \
    '{settings: {clientId: $a, clientSecret: $b, callbackSigningSecret: $c}}' |
  curl -sS -o "$tmp_dir/put.json" -w '%{http_code}' -X PUT "$API/v1/admin/connectors/algoan_credit" \
    -H 'content-type: application/json' --data-binary @-)
[[ "$status" == 200 ]] || die "storing the connector settings answered HTTP $status: $(head -c 200 "$tmp_dir/put.json")"
ok "connector settings stored"

# --- 4. Algoan subscriptions --------------------------------------------------

section "4. Algoan webhook subscriptions"

if [[ -n "$TUNNEL" ]]; then
  pause "recreate the Algoan subscriptions for $TUNNEL$CALLBACK_PATH"
  node "$SCRIPT_DIR/algoan-subscriptions.cjs" create --target "$TUNNEL$CALLBACK_PATH" \
    --events analysis_completed,analysis_failed --secret-from-connector || die "could not create the subscriptions"
else
  info "skipped (no TUNNEL)"
fi

# --- 5. start, applicant, consent ---------------------------------------------

section "5. Start the onboarding on $WORKFLOW_ID"

pause "create the onboarding"
ID=$(curl -sS -X POST "$API/v1/onboardings" -H 'content-type: application/json' \
  -d "{\"workflowId\":\"$WORKFLOW_ID\"}" | jq -r '.onboardingId // empty')
[[ -n "$ID" ]] || die "the engine did not return an onboardingId (is $WORKFLOW_ID loaded?)"
ok "onboardingId=$ID"
[[ "$(current_step)" == applicant ]] || die "expected to start on 'applicant', got '$(current_step)'"

section "6. Applicant and consent"
submit "$APPLICANT_JSON" credit_consent
submit "$CONSENT_JSON" credit_check

# --- 7. bank data -------------------------------------------------------------

section "7. Bank data ($PERSONA, dates re-based to today)"

node "$SCRIPT_DIR/rebase-bank-data-dates.cjs" "$PERSONA_FILE" "$tmp_dir/bank-data.json"
upload_document bankData application/json "$tmp_dir/bank-data.json"
submit "{\"bankData\":\"$DOCUMENT_ID\"}" credit_check

# --- 8. wait for the result ---------------------------------------------------

section "8. Waiting for the result (up to ${CREDIT_TIMEOUT}s)"

waited=0
while (( waited < CREDIT_TIMEOUT )); do
  snapshot=$(state)
  step=$(printf '%s' "$snapshot" | jq -r '.currentStep // "null"')
  pending=$(printf '%s' "$snapshot" | jq -r '.pending != null')
  if [[ "$pending" == false && "$step" != credit_check ]]; then break; fi
  sleep 3
  waited=$((waited + 3))
done

if (( waited >= CREDIT_TIMEOUT )); then
  info "still pending after ${CREDIT_TIMEOUT}s - the webhook may not have arrived (stale tunnel, subscription, signature)"
  pause "ask the engine to read the verdict back (POST .../pending-connector/reconcile)"
  curl -sS -X POST "$API/v1/onboardings/$ID/pending-connector/reconcile" -H 'content-type: application/json' -d '{}' |
    jq -c '{outcome}'
  snapshot=$(state)
fi

printf '%s' "$snapshot" | jq '{currentStep, creditOutcome: .data.creditOutcome, creditScore: .data.creditScore, creditScoreBand: .data.creditScoreBand}'
ok "done - onboardingId=$ID"
