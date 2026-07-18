#!/usr/bin/env bash
set -Eeuo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WEB_DIRECTORY="$REPOSITORY_ROOT/apps/web"
CAST_BINARY="$HOME/.foundry/bin/cast"
ACCOUNT_NAME="submittedit-relayer"
DATABASE_CONTAINER="submittedit-goal11-smoke-postgres"
DATABASE_NAME="submittedit_goal11_smoke_test"
DATABASE_PORT="55432"
DATABASE_URL_VALUE="postgresql://postgres:postgres@127.0.0.1:${DATABASE_PORT}/${DATABASE_NAME}"
PUBLIC_RESULT=""
KEY_SOURCE_PID=""
CONTAINER_STARTED=false
SECRET_FD_OPEN=false

unset_smoke_environment() {
  unset CI DATABASE_URL TEST_DATABASE_URL
  unset RUN_MONAD_RELAY_SMOKE SUBMITTEDIT_MONAD_SMOKE_CONFIRM
  unset SUBMITTEDIT_RELAYER_ACCOUNT SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS
  unset SUBMITTEDIT_RELAYER_PRIVATE_KEY SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD
  unset SUBMITTEDIT_RELAY_ABUSE_HASH_KEY SUBMITTEDIT_RELAY_ENABLED
  unset SUBMITTEDIT_RELAY_RPC_URL SUBMITTEDIT_RELAY_CHAIN_ID
  unset SUBMITTEDIT_RELAY_CONTRACT_ADDRESS SUBMITTEDIT_RELAY_DAILY_BUDGET_WEI
  unset SUBMITTEDIT_RELAY_MINIMUM_BALANCE_WEI SUBMITTEDIT_RELAY_LOW_BALANCE_WEI
  unset SUBMITTEDIT_RELAY_CONFIRMATIONS SUBMITTEDIT_RELAY_CONFIRMATION_TIMEOUT_MS
  unset SUBMITTEDIT_RELAY_CONFIRMATION_POLL_INTERVAL_MS
  unset SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT
  unset SUBMITTEDIT_RELAY_MAX_CONFIRMATION_POLLS
  unset SUBMITTEDIT_RELAY_RATE_WINDOW_SECONDS SUBMITTEDIT_RELAY_IP_RATE_LIMIT
  unset SUBMITTEDIT_RELAY_PUBLIC_KEY_RATE_LIMIT SUBMITTEDIT_RELAY_RECEIPT_RATE_LIMIT
  unset SUBMITTEDIT_RELAY_TRUST_PROXY
}

cleanup_resources() {
  local cleanup_status=0
  set +e
  if [[ "$SECRET_FD_OPEN" == true ]]; then
    exec 3<&-
    SECRET_FD_OPEN=false
  fi
  if [[ -n "$KEY_SOURCE_PID" ]]; then
    wait "$KEY_SOURCE_PID" >/dev/null 2>&1
    KEY_SOURCE_PID=""
  fi
  if [[ "$CONTAINER_STARTED" == true ]]; then
    docker rm --force "$DATABASE_CONTAINER" >/dev/null 2>&1 || cleanup_status=$?
    CONTAINER_STARTED=false
  fi
  if [[ -n "$PUBLIC_RESULT" ]]; then
    rm -f -- "$PUBLIC_RESULT" || cleanup_status=$?
  fi
  unset_smoke_environment
  set -e
  return "$cleanup_status"
}

exit_cleanup() {
  local status=$?
  trap - EXIT INT TERM HUP
  cleanup_resources || true
  exit "$status"
}

trap exit_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP

case "${1:-}" in
  "") MODE="execute" ;;
  --dry-run) MODE="dry-run" ;;
  *)
    echo "Usage: pnpm test:relay-monad-smoke:wallet [--dry-run]" >&2
    exit 2
    ;;
esac

cd "$WEB_DIRECTORY"

if [[ "$MODE" == "dry-run" ]]; then
  node scripts/relay-monad-smoke-guard.mjs --dry-run
  trap - EXIT INT TERM HUP
  exit 0
fi

node scripts/relay-monad-smoke-guard.mjs --preflight

pnpm --filter @submittedit/receipt-core build
pnpm --filter @submittedit/contract-client build

if [[ -n "$(docker ps --all --quiet --filter "name=^/${DATABASE_CONTAINER}$")" ]]; then
  echo "The dedicated smoke database container name is already in use." >&2
  exit 1
fi

docker run --detach --rm \
  --name "$DATABASE_CONTAINER" \
  --publish "127.0.0.1:${DATABASE_PORT}:5432" \
  --env POSTGRES_DB="$DATABASE_NAME" \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD=postgres \
  --tmpfs /var/lib/postgresql/data:rw,noexec,nosuid,size=1073741824 \
  --health-cmd="pg_isready -U postgres -d $DATABASE_NAME" \
  --health-interval=2s \
  --health-timeout=3s \
  --health-retries=30 \
  postgres:17-alpine >/dev/null
CONTAINER_STARTED=true

for _ in $(seq 1 60); do
  if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$DATABASE_CONTAINER")" == "healthy" ]]; then
    break
  fi
  sleep 1
done
if [[ "$(docker inspect --format '{{.State.Health.Status}}' "$DATABASE_CONTAINER")" != "healthy" ]]; then
  echo "The disposable smoke database did not become healthy." >&2
  exit 1
fi

export CI=false
export DATABASE_URL="$DATABASE_URL_VALUE"
export TEST_DATABASE_URL="$DATABASE_URL_VALUE"
export SUBMITTEDIT_RELAYER_ACCOUNT="$ACCOUNT_NAME"
export SUBMITTEDIT_RELAYER_PRIVATE_KEY_FD=3
export SUBMITTEDIT_RELAY_ENABLED=true
export SUBMITTEDIT_RELAY_RPC_URL=https://testnet-rpc.monad.xyz
export SUBMITTEDIT_RELAY_CHAIN_ID=10143
export SUBMITTEDIT_RELAY_CONTRACT_ADDRESS=0x63914900a2D3571F92506821a76c4036C3e25883
export SUBMITTEDIT_RELAY_DAILY_BUDGET_WEI=25000000000000000
export SUBMITTEDIT_RELAY_MINIMUM_BALANCE_WEI=4950000000000000000
export SUBMITTEDIT_RELAY_LOW_BALANCE_WEI=4990000000000000000
export SUBMITTEDIT_RELAY_CONFIRMATIONS=3
export SUBMITTEDIT_RELAY_CONFIRMATION_TIMEOUT_MS=60000
export SUBMITTEDIT_RELAY_CONFIRMATION_POLL_INTERVAL_MS=500
export SUBMITTEDIT_RELAY_MAX_ATTEMPTS_PER_EVENT=1
export SUBMITTEDIT_RELAY_MAX_CONFIRMATION_POLLS=1
export SUBMITTEDIT_RELAY_RATE_WINDOW_SECONDS=60
export SUBMITTEDIT_RELAY_IP_RATE_LIMIT=1
export SUBMITTEDIT_RELAY_PUBLIC_KEY_RATE_LIMIT=1
export SUBMITTEDIT_RELAY_RECEIPT_RATE_LIMIT=1
export SUBMITTEDIT_RELAY_TRUST_PROXY=false
unset SUBMITTEDIT_RELAYER_PRIVATE_KEY SUBMITTEDIT_RELAY_ABUSE_HASH_KEY
unset CAST_PASSWORD ETH_KEYSTORE ETH_KEYSTORE_ACCOUNT ETH_PASSWORD PRIVATE_KEY

node scripts/relay-monad-smoke-guard.mjs --validate-child
node scripts/migrate.mjs

PUBLIC_RESULT="$(mktemp /tmp/submittedit-monad-smoke-public.XXXXXX)"
exec 3< <("$CAST_BINARY" wallet private-key --account "$ACCOUNT_NAME")
KEY_SOURCE_PID=$!
SECRET_FD_OPEN=true

node scripts/test-relay-monad-smoke.mjs 3<&3 | tee "$PUBLIC_RESULT"

exec 3<&-
SECRET_FD_OPEN=false
wait "$KEY_SOURCE_PID"
KEY_SOURCE_PID=""

if ! rg -q '\{"developmentOnly":true,"eventHash":"0x[0-9a-f]{64}","receiptId":"0x[0-9a-f]{64}","transactionHash":"0x[0-9a-f]{64}"\}' "$PUBLIC_RESULT"; then
  echo "The smoke test did not emit its reviewed public result record." >&2
  exit 1
fi

cleanup_resources

if [[ -n "$(docker ps --all --quiet --filter "name=^/${DATABASE_CONTAINER}$")" ]]; then
  echo "The disposable smoke database container remains after cleanup." >&2
  exit 1
fi
if [[ -e "$PUBLIC_RESULT" || -e "/proc/$$/fd/3" ]]; then
  echo "A smoke descriptor or temporary result remains after cleanup." >&2
  exit 1
fi
if [[ -n "$(jobs -pr)" ]]; then
  echo "A smoke child process remains after cleanup." >&2
  exit 1
fi
if env | rg -q '^(RUN_MONAD_RELAY_SMOKE|SUBMITTEDIT_MONAD_SMOKE_CONFIRM|SUBMITTEDIT_RELAYER_EXPECTED_ADDRESS|SUBMITTEDIT_RELAYER_PRIVATE_KEY(_FD)?|SUBMITTEDIT_RELAY_ABUSE_HASH_KEY|ETH_PASSWORD|CAST_PASSWORD)='; then
  echo "A smoke or secret-bearing environment variable remains after cleanup." >&2
  exit 1
fi

node "$REPOSITORY_ROOT/scripts/check-secrets.mjs"
test -z "$(git -C "$REPOSITORY_ROOT" status --short)"
git -C "$REPOSITORY_ROOT" check-ignore -q AGENTS.override.md
if git -C "$REPOSITORY_ROOT" ls-files --error-unmatch AGENTS.override.md >/dev/null 2>&1; then
  echo "AGENTS.override.md must remain untracked." >&2
  exit 1
fi

trap - EXIT INT TERM HUP
echo "Monad relay smoke and residue checks completed exactly once."
