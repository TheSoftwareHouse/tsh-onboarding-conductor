#!/usr/bin/env bash
#
# Drives revision 2 of the EU B2C individual KYC (EEA) onboarding — the specialized-steps form — end to
# end against a local stack, from collect_contact through to approved, using the real Sumsub and
# Twilio tenants. It runs the workflows/users/eu-b2c-individual-kyc-eea-v2-local.workflow.json
# definition: a copy of workflows/built-in/eu-b2c-individual-kyc-eea-v2.workflow.json under its
# own id, whose provision_account step points at a local stub instead of a real account system.
# It has its own id rather than being revision 2 of the id run-eu-b2c-kyc-manual-test.sh uses,
# because POST /v1/onboardings always starts the latest revision of an id and the two scripts
# must not start each other's flow.
#
# The run is run-eu-b2c-kyc-manual-test.sh with one more call. Revision 2 collects the contact
# details in one step and proves the phone number in another, so the SMS is no longer sent by
# the submit that carries the number: that submit lands on send_phone_code, and an empty submit
# there (section 8a) sends the code. Every step after that is the same, under the same names.
#
# Section numbers below mirror the manual walkthrough of revision 1, so the two can be read side
# by side; the extra call is 8a. The stack, the tunnel and the connector credentials are assumed
# to be in place already — this script drives the calls, not the setup. The provisioning stub is
# the one exception: it is started here and stopped again on the way out.
#
#   ./scripts/run-eu-b2c-kyc-manual-test-v2.sh
#
# That is the whole invocation. Two things are typed at the terminal while the run is under way —
# the number the SMS goes to, and the six digits that come back — and everything else the flow
# needs is written into the script.
#
# Nothing advances on a timer. The run stops at every step and waits for Enter: on arriving at a
# step it makes that step's own calls (reserve, upload, complete), then holds before submitting,
# so the state can be inspected first. AUTO_CONFIRM=1 walks through all of those gates without
# waiting, for a run you do not want to sit through.
#
# It also stops for the one thing neither it nor you can hurry: approving the applicant as GREEN
# in the Sumsub dashboard.
#
# Every setting below is read from the environment first and falls back to the value written into
# the block, so editing the file and exporting a variable both work.

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# --- fill these in ------------------------------------------------------------
# Edit the defaults below and the script needs no arguments. Each one can still be
# overridden for a single run: FRONT=~/id-front.png ./scripts/run-eu-b2c-kyc-manual-test-v2.sh
#
# The phone number and the SMS code are deliberately not here: both are asked for at the terminal
# while the run is under way. A number sitting in a file goes stale, and a code does not exist
# until the run has already sent the SMS.

# Anchored to the script's own directory, so the run works from any working directory. An
# override is taken as typed, and a relative one is resolved against the shell's directory.
FRONT=${FRONT:-$SCRIPT_DIR/eu-b2c-individual-kyc-workflow/sumsub_front.png}
BACK=${BACK:-$SCRIPT_DIR/eu-b2c-individual-kyc-workflow/sumsub_back.png}
SELFIE=${SELFIE:-$SCRIPT_DIR/eu-b2c-individual-kyc-workflow/example-kyc-image.jpeg}

# The cloudflared URL from terminal C. Optional, and never prompted for: the script only uses
# it to check the tunnel reaches the engine, and skips that check when it is empty. It is the
# webhook configured in the Sumsub dashboard, not this value, that decides whether the verdict
# in section 26 ever arrives — so a wrong or stale URL here costs an early warning, nothing more.
# cloudflared mints a new URL per run, which is why this is usually passed inline rather than
# filled in: TUNNEL='https://x.trycloudflare.com' ./scripts/run-eu-b2c-kyc-manual-test-v2.sh
TUNNEL=${TUNNEL:-''}

# --- the rest rarely changes --------------------------------------------------

API=${API:-http://localhost:3000}
STUB=${STUB:-http://localhost:4600}
KYC_TIMEOUT=${KYC_TIMEOUT:-600}

# How long the wait for the SMS code may last. Twilio expires a verification code on its own — a
# longer wait here only means submitting a code the provider has already rejected.
CODE_TIMEOUT=${CODE_TIMEOUT:-600}

# How long every other prompt waits before giving up. Bounded so that an input which is open but
# never delivers anything — a wrapper process, nohup — fails with a message instead of hanging.
ASK_TIMEOUT=${ASK_TIMEOUT:-120}

# Set to 1 to walk through every Enter gate without waiting.
AUTO_CONFIRM=${AUTO_CONFIRM:-''}
WORKFLOW_ID=eu-b2c-individual-kyc-eea-v2-local

# The account-system stub the local workflow's provision_account step calls. Section 6 starts it
# unless something is already answering on $STUB, and only what this run started is stopped again.
STUB_SCRIPT=${STUB_SCRIPT:-$SCRIPT_DIR/eu-b2c-individual-kyc-workflow/host-stubs.cjs}
STUB_START_TIMEOUT=${STUB_START_TIMEOUT:-15}

# Taken from $STUB, so pointing the run at another port moves the stub with it.
STUB_PORT=${STUB_PORT:-$(printf '%s' "${STUB##*:}" | tr -dc '0-9')}
STUB_PORT=${STUB_PORT:-4600}

PHONE=''
CODE=''
ID=''
DOCUMENT_ID=''
STUB_PID=''

tmp_workflow=$(mktemp)
STUB_LOG=$(mktemp)

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

# Stop the stub this run started — one that was already listening belongs to whoever started it
# and is left alone. Its log outlives the run: it is the only record of what the engine sent.
cleanup() {
  rm -f "$tmp_workflow"

  if [[ -n "$STUB_PID" ]] && kill -0 "$STUB_PID" 2>/dev/null; then
    kill "$STUB_PID" 2>/dev/null || true
    wait "$STUB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- helpers ------------------------------------------------------------------

file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1"
}

# ask <prompt> [timeout]: read one value and echo it, preferring the terminal over stdin so the
# prompt works even when the script's input is redirected. Answers non-zero when the input timed
# out or ended, which is what separates "nothing was typed yet" from "nothing ever will be".
#
# The prompt is printed with printf rather than `read -p`, and only the /dev/tty probe is
# stderr-silenced. `read -p` writes its prompt to stderr, so silencing the read to hide a
# failed tty open hides the prompt too, and the script then waits on input with nothing on
# screen — indistinguishable from a hang.
ask() {
  local answer='' fd=0 tty_open=false status=0
  local timeout=${2:-$ASK_TIMEOUT}

  if { exec 3< /dev/tty; } 2>/dev/null; then
    fd=3
    tty_open=true
  fi

  # To stderr: this runs inside a command substitution, which captures stdout.
  printf '    %s: ' "$1" >&2
  read -r -t "$timeout" -u "$fd" answer || { status=1; printf '\n' >&2; }
  if [[ "$tty_open" == true ]]; then
    exec 3<&-
  fi

  printf '%s' "$answer"

  return "$status"
}

# ask_phone: keep asking until an E.164 number is typed. Sets $PHONE. A number typed in the shape
# people write it — spaces, dashes — is accepted and normalised rather than rejected.
ask_phone() {
  local answer=''

  while :; do
    if ! answer=$(ask 'Your number in E.164, e.g. +48600000000'); then
      die "no phone number after ${ASK_TIMEOUT}s — this run needs one typed at the terminal"
    fi

    answer=${answer//[[:space:]]/}
    answer=${answer//-/}

    if [[ "$answer" =~ ^\+[0-9]{6,15}$ ]]; then
      PHONE=$answer

      return 0
    fi

    if [[ -z "$answer" ]]; then
      info "nothing typed — the number is where the SMS goes, so the run cannot start without it"
    else
      info "'$answer' is not E.164 — it must be a '+' followed by 6 to 15 digits"
    fi
  done
}

# ask_code: keep asking until the digits from the SMS are typed. Sets $CODE.
ask_code() {
  local answer='' digits=''

  printf '    %sTake the 6 digits from the SMS sent to %s.%s\n' "$BOLD" "$PHONE" "$RESET"
  info "giving up after ${CODE_TIMEOUT}s, since the code expires on Twilio's side anyway"

  while :; do
    if ! answer=$(ask 'The code from the SMS' "$CODE_TIMEOUT"); then
      die "no code after ${CODE_TIMEOUT}s — the SMS code has likely expired; start a fresh run"
    fi

    # Tolerate however it was pasted: spaces between the digits, a "code: " prefix.
    digits=${answer//[^0-9]/}
    if [[ -n "$digits" ]]; then
      CODE=$digits

      return 0
    fi

    info "'$answer' holds no digits — type the digits from the SMS"
  done
}

# pause <what>: hold the run until Enter is pressed, so the state can be inspected before it moves
# on. Unlike ask(), this does not run inside a command substitution, so its prompt goes to stdout
# with the rest of the run's narration.
#
# An input with nothing left to give — /dev/null, a closed pipe — reads as EOF and continues
# rather than stalling on an Enter nobody can press.
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

# start_stub: bring up the account-system stub, unless one is already answering on $STUB — a stub
# left running from an earlier run is reused as it stands, and keeps the accounts it already holds.
start_stub() {
  local waited=0

  if curl -sS --max-time 5 "$STUB/__health" >/dev/null 2>&1; then
    ok "a provisioning stub is already listening on $STUB — using that one"

    return 0
  fi

  command -v node >/dev/null || die "node is not installed — it is needed to run $STUB_SCRIPT"
  [[ -f "$STUB_SCRIPT" ]] || die "no provisioning stub to start: $STUB_SCRIPT is missing"

  info "starting $STUB_SCRIPT on port $STUB_PORT"
  STUB_PORT=$STUB_PORT node "$STUB_SCRIPT" >"$STUB_LOG" 2>&1 &
  STUB_PID=$!

  while (( waited < STUB_START_TIMEOUT )); do
    if curl -sS --max-time 2 "$STUB/__health" >/dev/null 2>&1; then
      ok "provisioning stub is listening (pid $STUB_PID), log: $STUB_LOG"

      return 0
    fi

    kill -0 "$STUB_PID" 2>/dev/null || break
    sleep 1
    waited=$((waited + 1))
  done

  if [[ -s "$STUB_LOG" ]]; then
    printf '%s%s%s\n' "$DIM" "$(tail -n 20 "$STUB_LOG")" "$RESET" >&2
  fi
  die "the provisioning stub did not answer on $STUB within ${STUB_START_TIMEOUT}s — see $STUB_LOG"
}

state() {
  curl -sS "$API/v1/onboardings/$ID/state"
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

# post_submit <json> <expected-next-step>: POST /submit, assert where it landed.
post_submit() {
  local body=$1 want=$2
  curl -sS -X POST "$API/v1/onboardings/$ID/submit" \
    -H 'content-type: application/json' -d "$body" | jq -c '{status,currentStep}'
  expect_step "$want"
}

# submit <json> <expected-next-step>: the gated form — wait for Enter, then post_submit. Every
# step goes through here, which is what makes the run advance one Enter press at a time.
submit() {
  pause "submit $(current_step)"
  post_submit "$@"
}

# upload_document <field> <contentType> <path>: reserve, send the bytes, complete.
# Leaves the reserved id in $DOCUMENT_ID for the submit that follows.
upload_document() {
  local field=$1 content_type=$2 path=$3
  local reserve upload_url
  local -a form=()

  info "reserving $field ($content_type, $(file_size "$path") bytes)"
  reserve=$(curl -sS -X POST "$API/v1/onboardings/$ID/documents" \
    -H 'content-type: application/json' \
    -d "{\"field\":\"$field\",\"contentType\":\"$content_type\",\"sizeBytes\":$(file_size "$path")}")

  DOCUMENT_ID=$(printf '%s' "$reserve" | jq -r '.documentId // empty')
  # The engine hands back the in-network minio host; rewrite it so this shell can reach it.
  upload_url=$(printf '%s' "$reserve" | jq -r '.upload.url // empty | sub("//minio:"; "//localhost:")')
  [[ -n "$DOCUMENT_ID" && -n "$upload_url" ]] || die "could not reserve $field: $reserve"

  while IFS= read -r entry; do
    form+=(-F "$entry")
  done < <(printf '%s' "$reserve" | jq -r '.upload.fields | to_entries[] | "\(.key)=\(.value)"')

  info "documentId=$DOCUMENT_ID"
  info "sending the bytes to $upload_url"
  local status
  status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$upload_url" "${form[@]}" -F "file=@$path")
  [[ "$status" == "204" || "$status" == "200" ]] || die "upload of $field answered HTTP $status"
  ok "stored (HTTP $status)"

  info "completing the upload"
  curl -sS -X POST "$API/v1/onboardings/$ID/documents/$DOCUMENT_ID/complete" \
    -H 'content-type: application/json' -d '{}' | jq -c '{documentId}'
}

# --- 5. inputs ----------------------------------------------------------------

section "Checking inputs"

command -v curl >/dev/null || die "curl is not installed"
command -v jq >/dev/null || die "jq is not installed"

for f in "$FRONT" "$BACK" "$SELFIE"; do
  [[ -f "$f" ]] || die "image not found: $f (override with FRONT/BACK/SELFIE)"
done
ok "FRONT=$FRONT"
ok "BACK=$BACK"
ok "SELFIE=$SELFIE"

# Asked for rather than configured: this is the number a real SMS goes to, and the images above
# have already been checked, so nothing is typed for a run that was going to fail anyway.
ask_phone
ok "PHONE=$PHONE"

# --- 6. smoke test ------------------------------------------------------------

section "6. Smoke test"

curl -sS --max-time 5 "$API/v1/health/live" >/dev/null || die "the engine is not answering on $API — run pnpm stack:up"
ok "engine is up"

if [[ -n "${TUNNEL:-}" ]]; then
  curl -sS --max-time 10 "$TUNNEL/v1/health/live" >/dev/null || die "the tunnel $TUNNEL does not reach the engine"
  ok "tunnel reaches the engine"
else
  info "TUNNEL not set — skipping the tunnel check; nothing else here needs it"
  info "if the Sumsub webhook cannot reach the engine, section 26 waits the full ${KYC_TIMEOUT}s"
fi

# The admin read is guarded when ADMIN_AUTH_ENABLED=true, and this script carries no token; a
# 401/503 there says nothing about the workflow, so it is reported and stepped over.
workflow_status=$(curl -sS -o "$tmp_workflow" -w '%{http_code}' "$API/v1/admin/workflows/$WORKFLOW_ID")
case "$workflow_status" in
  200)
    jq -e --arg id "$WORKFLOW_ID" '.workflowId == $id' "$tmp_workflow" >/dev/null \
      || die "$API answered for $WORKFLOW_ID with an unexpected body: $(head -c 200 "$tmp_workflow")"
    ok "workflow $WORKFLOW_ID is loaded (version $(jq -r '.workflowVersion' "$tmp_workflow"))"
    ;;
  401 | 403 | 503)
    info "admin auth is on (HTTP $workflow_status) — cannot confirm the workflow is loaded; call 1 will tell"
    ;;
  *)
    die "workflow $WORKFLOW_ID is not loaded (HTTP $workflow_status) — check workflows/users/ and restart the engine"
    ;;
esac

# The engine runs in Compose and reaches this as http://host.docker.internal:$STUB_PORT, so on
# macOS the first run may raise the firewall's "accept incoming connections" prompt.
start_stub

# --- 7. create ----------------------------------------------------------------

section "7. Call 1 — create the onboarding"

pause "create the onboarding"
ID=$(curl -sS -X POST "$API/v1/onboardings" -H 'content-type: application/json' \
  -d "{\"workflowId\":\"$WORKFLOW_ID\"}" | jq -r '.onboardingId // empty')
[[ -n "$ID" ]] || die "the engine did not return an onboardingId"
ok "onboardingId=$ID"
expect_step collect_contact

# --- 8. contact ---------------------------------------------------------------

section "8. Call 2 — contact details (no SMS yet: revision 2 sends it from the next step)"

# The contact-details step collects and publishes the number; nothing is sent until the
# otp-verify step's own compiled step runs.
submit "{\"email\":\"freya.krause@example.com\",\"phoneNumber\":\"$PHONE\",\"termsAccepted\":true,\"privacyNoticeAcknowledged\":true,\"marketingConsent\":false}" \
  send_phone_code

# --- 8a. send the code ----------------------------------------------------------

section "8a. Call 2a — send the code (sends a real SMS to $PHONE)"

# Empty body: send_phone_code declares no fields, so submitting it runs the Twilio start
# connector against the number published by collect_contact. Sent exactly once — a second empty
# submit starts a second verification.
submit '{}' verify_phone_code

# --- 9. the SMS code ----------------------------------------------------------

section "9. Call 3 — the SMS code"

# Typing the code is this step's own Enter press, so it submits straight away rather than asking
# for a second one on top.
ask_code
ok "using code $CODE"

post_submit "{\"verificationCode\":\"$CODE\"}" collect_personal

# --- 10. personal details -----------------------------------------------------

section "10. Call 4 — personal details"

submit '{"firstName":"Freya","lastName":"Krause","dateOfBirth":"1982-03-24","nationality":"DE","street":"Heidestrasse 19","town":"Köln","postCode":"51247","country":"DE","actingForSelf":true}' \
  collect_purpose

# --- 11. questionnaire --------------------------------------------------------

section "11. Call 5 — questionnaire"

submit '{"accountPurpose":"salary","employmentStatus":"employed","occupationGroup":"isco_2","occupationTitle":"Software engineer","sourceOfFunds":"salary","monthlyIncomingBand":"5k_15k","monthlyOutgoingBand":"1k_5k","pepSelfDeclared":false}' \
  select_document_type

# --- 12. document type --------------------------------------------------------

section "12. Call 6 — document type"

submit '{"documentType":"ID_CARD","idCardIssuingCountry":"DE"}' capture_id_card_front

# --- 13-16. ID-card front -----------------------------------------------------

section "13-16. Calls 7-10 — the ID-card front"

upload_document idCardFront image/png "$FRONT"
expect_step capture_id_card_front
submit "{\"idCardFront\":\"$DOCUMENT_ID\"}" capture_id_card_back

# --- 17-20. ID-card back ------------------------------------------------------

section "17-20. Calls 11-14 — the ID-card back"

upload_document idCardBack image/png "$BACK"
expect_step capture_id_card_back
submit "{\"idCardBack\":\"$DOCUMENT_ID\"}" capture_selfie

# --- 21-24. selfie ------------------------------------------------------------

section "21-24. Calls 15-18 — the selfie"

upload_document selfieDocument image/jpeg "$SELFIE"
expect_step capture_selfie
submit "{\"selfieDocument\":\"$DOCUMENT_ID\"}" submit_kyc

# --- 25. fire the KYC submission ---------------------------------------------

section "25. Call 19 — fire the KYC submission"

# submit_kyc comes back as currentStep: the connector is parked on the callback, not failing.
# Sent exactly once — a second empty submit re-runs the whole submission.
submit '{}' submit_kyc

# --- 26. the Sumsub verdict ---------------------------------------------------

section "26. Call 20 — waiting for the Sumsub verdict"

printf '    %sApprove externalUserId == %s as GREEN in the Sumsub dashboard.%s\n' "$BOLD" "$ID" "$RESET"
pause "start watching for the verdict"
info "polling for up to ${KYC_TIMEOUT}s; a manual_review verdict is approved automatically"

deadline=$((SECONDS + KYC_TIMEOUT))
while :; do
  step=$(current_step)
  case "$step" in
    provision_account) break ;;
    manual_review)
      info "verdict routed to manual_review — approving"
      curl -sS -X POST "$API/v1/onboardings/$ID/review/approve" | jq -c '{status,currentStep}'
      ;;
    *) show_state ;;
  esac
  (( SECONDS < deadline )) || die "still on '$step' after ${KYC_TIMEOUT}s — check the webhook and the dashboard verdict"
  sleep 5
done
ok "on provision_account"

# --- 27. provision the account ------------------------------------------------

section "27. Call 21 — provision the account"

# Empty body: the step declares no fields, so submitting it runs the http_request
# connector against the stub.
submit '{}' await_account

info "what the stub received:"
curl -sS "$STUB/__received" | jq '.accounts[-1]'

USER_ID="acct-$(curl -sS "$STUB/__received" | jq '.accounts | length')"
ok "USER_ID=$USER_ID"

# --- 28. hand back the account id ---------------------------------------------

section "28. Call 22 — hand back the account id"

submit "{\"userId\":\"$USER_ID\"}" null

final=$(show_state)
printf '\n%s%s%s\n' "$GREEN" "$final" "$RESET"
[[ "$(state | jq -r '.status')" == "approved" ]] || die "the run did not end approved — $final"
ok "run complete: onboarding $ID is approved"
if [[ -n "$STUB_PID" ]]; then
  info "the stub's log stays behind at $STUB_LOG"
fi
