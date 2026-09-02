#!/usr/bin/env bash
#
# Drives the EU B2C individual KYC (EEA) onboarding end to end against a local stack, from
# collect_contact through to approved, using the real Sumsub and Twilio tenants. It runs the
# workflows/users/eu-b2c-individual-kyc-eea-local.workflow.json definition, whose
# provision_account step points at a local stub instead of a real account system.
#
# Section numbers below mirror the manual walkthrough this automates, so the two can be read
# side by side. The stack, the provisioning stub, the tunnel and the connector credentials are
# assumed to be in place already — this script drives the calls, not the setup.
#
#   ./scripts/run-eu-b2c-kyc-manual-test.sh
#
# Fill in the block below — at minimum PHONE — and that is the whole invocation.
#
# The run advances one step at a time. On arriving at a step it makes that step's own calls
# (reserve, upload, complete), then stops and waits for Enter before submitting, so the state
# can be inspected first. AUTO_CONFIRM=1 submits every step as soon as it is ready instead,
# for an unattended run.
#
# It also stops for the two things only you can supply: the SMS code, and approving the
# applicant as GREEN in the Sumsub dashboard.
#
# Every setting is read from the environment first and falls back to the value written into
# the block below, so editing the file and exporting a variable both work.

set -euo pipefail

# --- fill these in ------------------------------------------------------------
# Edit the defaults below and the script needs no arguments. Each one can still be
# overridden for a single run: PHONE='+48...' ./run-manual-local-test.sh

# Your number in E.164 — receives a real SMS. Left empty, the script asks for it.
PHONE=${PHONE:-''}

# The 6 digits from that SMS. Leave empty: they do not exist until the run is under way,
# so the script stops at that step and waits. Fill it only to replay a code you know.
CODE=${CODE:-''}

# Where the script also watches for those digits while it waits, so the code can be handed
# over by writing a file instead of typing at the prompt:
#
#   echo 123456 > scripts/.sms-code
#
# An exported variable cannot be used for this: a process holds a copy of the environment it
# started with, so nothing set afterwards would reach the run.
CODE_FILE=${CODE_FILE:-$(dirname "$0")/.sms-code}

# How long that wait may last. Twilio expires a verification code on its own — a longer wait
# here only means submitting a code the provider has already rejected.
CODE_TIMEOUT=${CODE_TIMEOUT:-600}

# How long a prompt waits before giving up. Bounded so that an input which is open but never
# delivers anything — a wrapper process, nohup — fails with a message instead of hanging.
ASK_TIMEOUT=${ASK_TIMEOUT:-120}

FRONT=${FRONT:-$HOME/Downloads/sumsub_front.png}
BACK=${BACK:-$HOME/Downloads/sumsub_back.png}
SELFIE=${SELFIE:-$HOME/Downloads/example-kyc-image.jpeg}

# The cloudflared URL from terminal C. Optional, and never prompted for: the script only uses
# it to check the tunnel reaches the engine, and skips that check when it is empty. It is the
# webhook configured in the Sumsub dashboard, not this value, that decides whether the verdict
# in section 26 ever arrives — so a wrong or stale URL here costs an early warning, nothing more.
# cloudflared mints a new URL per run, which is why this is usually passed inline rather than
# filled in: TUNNEL='https://x.trycloudflare.com' ./run-manual-local-test.sh
TUNNEL=${TUNNEL:-''}

# --- the rest rarely changes --------------------------------------------------

API=${API:-http://localhost:3000}
STUB=${STUB:-http://localhost:4600}
KYC_TIMEOUT=${KYC_TIMEOUT:-600}

# Set to 1 to submit every step as soon as it is ready, instead of waiting for Enter.
AUTO_CONFIRM=${AUTO_CONFIRM:-''}
WORKFLOW_ID=eu-b2c-individual-kyc-eea-local

ID=''
DOCUMENT_ID=''

tmp_workflow=$(mktemp)
trap 'rm -f "$tmp_workflow" "$CODE_FILE"' EXIT

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

# --- helpers ------------------------------------------------------------------

file_size() {
  stat -f%z "$1" 2>/dev/null || stat -c%s "$1"
}

# ask <prompt>: read one value and echo it, preferring the terminal over stdin so the prompt
# works even when the script's input is redirected.
#
# The prompt is printed with printf rather than `read -p`, and only the /dev/tty probe is
# stderr-silenced. `read -p` writes its prompt to stderr, so silencing the read to hide a
# failed tty open hides the prompt too, and the script then waits on input with nothing on
# screen — indistinguishable from a hang.
ask() {
  local answer='' fd=0 tty_open=false

  if { exec 3< /dev/tty; } 2>/dev/null; then
    fd=3
    tty_open=true
  fi

  # To stderr: this runs inside a command substitution, which captures stdout.
  printf '    %s: ' "$1" >&2
  read -r -t "$ASK_TIMEOUT" -u "$fd" answer || printf '\n' >&2
  if [[ "$tty_open" == true ]]; then
    exec 3<&-
  fi

  printf '%s' "$answer"
}

# await_code: stop here until the verification code arrives, from whichever source produces
# it first — typed at the prompt, or written into $CODE_FILE. Sets $CODE.
await_code() {
  local answer='' digits='' waited=0 read_fd='' tty_open=false result=1

  printf '    %sWaiting for the 6 digits sent to %s.%s\n' "$BOLD" "$PHONE" "$RESET"
  info "type them here and press Enter, or from another terminal: echo 123456 > $CODE_FILE"
  info "giving up after ${CODE_TIMEOUT}s, since the code expires on Twilio's side anyway"

  # Where typed input can come from. Opening /dev/tty fails silently in some contexts even
  # where a readability test passes, so it is probed by actually opening it. A redirected
  # stdin is still read once, which is what makes `echo 123456 | this-script` work.
  if { exec 3< /dev/tty; } 2>/dev/null; then
    read_fd=3
    tty_open=true
  else
    read_fd=0
  fi

  while (( waited < CODE_TIMEOUT )); do
    if [[ -s "$CODE_FILE" ]]; then
      # Tolerate a trailing newline, quotes or a CODE=… prefix in whatever was written.
      digits=$(tr -dc '0-9' < "$CODE_FILE")
      if [[ -n "$digits" ]]; then
        rm -f "$CODE_FILE"
        ok "read the code from $CODE_FILE"
        CODE=$digits
        result=0
        break
      fi
    fi

    answer=''
    if [[ -n "$read_fd" ]]; then
      read -r -t 2 -u "$read_fd" answer || true

      if [[ -n "$answer" ]]; then
        digits=${answer//[^0-9]/}
        if [[ -n "$digits" ]]; then
          CODE=$digits
          result=0
          break
        fi
        info "'$answer' holds no digits — ignoring it"
      elif [[ "$tty_open" != true && ! -t 0 ]]; then
        # A pipe or a file answers instantly and stays exhausted, so reading it again would
        # spin the loop through its whole budget without waiting. Poll the file instead.
        read_fd=''
      fi
    fi

    # Only sleep when nothing above blocked for those two seconds.
    if [[ -z "$read_fd" ]]; then
      sleep 2
    fi
    waited=$((waited + 2))
  done

  if [[ "$tty_open" == true ]]; then
    exec 3<&-
  fi

  return "$result"
}

# confirm <step>: hold the run until Enter is pressed, so a step can be inspected before it is
# submitted. Unlike ask(), this does not run inside a command substitution, so its prompt goes
# to stdout with the rest of the run's narration.
#
# An input with nothing left to give — /dev/null, a closed pipe — reads as EOF and continues
# rather than stalling on an Enter nobody can press.
confirm() {
  local answer='' fd=0 tty_open=false

  if [[ "$AUTO_CONFIRM" == 1 ]]; then
    info "AUTO_CONFIRM=1 — submitting $1 without waiting"

    return 0
  fi

  if { exec 3< /dev/tty; } 2>/dev/null; then
    fd=3
    tty_open=true
  fi

  printf '    %sPress Enter to submit %s%s' "$BOLD" "$1" "$RESET"
  read -r -u "$fd" answer || printf '\n'
  if [[ "$tty_open" == true ]]; then
    exec 3<&-
  fi
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

# submit <json> <expected-next-step>: wait for Enter, POST /submit, assert where it landed.
submit() {
  local body=$1 want=$2
  confirm "$(current_step)"
  curl -sS -X POST "$API/v1/onboardings/$ID/submit" \
    -H 'content-type: application/json' -d "$body" | jq -c '{status,currentStep}'
  expect_step "$want"
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

if [[ -z "${PHONE:-}" ]]; then
  info "PHONE is empty — fill it in at the top of this script to skip this prompt"
  PHONE=$(ask 'Your number in E.164, e.g. +48600000000')
fi
[[ -n "${PHONE:-}" ]] || die "no phone number after ${ASK_TIMEOUT}s — fill PHONE in at the top of this script, or pass PHONE='+48600000000'"
[[ "$PHONE" == +* ]] || die "PHONE must be E.164, starting with '+': got '$PHONE'"
for f in "$FRONT" "$BACK" "$SELFIE"; do
  [[ -f "$f" ]] || die "image not found: $f (override with FRONT/BACK/SELFIE)"
done
# A code left behind by an earlier run would be picked up as this run's, so it goes now —
# before call 2 sends the SMS, which means anything written from here on is current.
rm -f "$CODE_FILE"

ok "PHONE=$PHONE"
ok "FRONT=$FRONT"
ok "BACK=$BACK"
ok "SELFIE=$SELFIE"

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

curl -sS --max-time 5 "$STUB/__received" >/dev/null \
  || die "no provisioning stub on $STUB — it must answer POST /v1/accounts and expose GET /__received; the local one is specifications/eu-b2c-individual-kyc-workflow/host-stubs.cjs"
ok "provisioning stub is listening"

# --- 7. create ----------------------------------------------------------------

section "7. Call 1 — create the onboarding"

ID=$(curl -sS -X POST "$API/v1/onboardings" -H 'content-type: application/json' \
  -d "{\"workflowId\":\"$WORKFLOW_ID\"}" | jq -r '.onboardingId // empty')
[[ -n "$ID" ]] || die "the engine did not return an onboardingId"
ok "onboardingId=$ID"
expect_step collect_contact

# --- 8. contact ---------------------------------------------------------------

section "8. Call 2 — contact details (sends a real SMS to $PHONE)"

submit "{\"email\":\"freya.krause@example.com\",\"phoneNumber\":\"$PHONE\",\"termsVersion\":\"2026-07-01\",\"termsAccepted\":true,\"privacyNoticeVersion\":\"2026-07-01\",\"privacyNoticeAcknowledged\":true,\"marketingConsent\":false}" \
  verify_phone_code

# --- 9. the SMS code ----------------------------------------------------------

section "9. Call 3 — the SMS code"

if [[ -z "${CODE:-}" ]]; then
  await_code || die "no code after ${CODE_TIMEOUT}s — the SMS code has likely expired; start a fresh run"
fi
ok "using code $CODE"

submit "{\"verificationCode\":\"$CODE\"}" collect_personal

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
