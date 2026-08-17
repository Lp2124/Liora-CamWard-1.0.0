#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

fail() {
  printf '\n[FAIL] %s\n' "$1" >&2
  return 1
}

run() {
  local label="$1"
  shift
  printf '\n===== %s =====\n' "$label"
  "$@"
}

printf '%s\n' '========================================' \
  ' LIORA CAMWARD — PURPLE TEAM REALITY GATE' \
  '========================================'

printf '\n===== GIT =====\n'
git status --short --branch
git rev-parse HEAD

PRODUCTION_DIRS=(app apps/mobile lib packages components db middleware.ts)
EXISTING_DIRS=()
for path in "${PRODUCTION_DIRS[@]}"; do
  [[ -e "$path" ]] && EXISTING_DIRS+=("$path")
done

printf '\n===== RULE 1: NO FABRICATED / PLACEHOLDER PRODUCTION CODE =====\n'
FORBIDDEN_PATTERN='Math\.random\(|TODO|FIXME|HACK|XXX|coming[[:space:]]+soon|placeholder|mock(ed|ing)?|simulat(ed|ion)|fake[[:space:]_-]*(result|scan|confidence|signature|finding)|dummy[[:space:]_-]*(data|result)|hardcod(ed|ing)[[:space:]_-]*(result|finding)|@ts-ignore|@ts-nocheck'
if grep -RInE "$FORBIDDEN_PATTERN" "${EXISTING_DIRS[@]}" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude-dir=dist \
  --exclude-dir=build \
  --exclude='*.test.ts' \
  --exclude='*.test.tsx' \
  --exclude='*.test.js' \
  --exclude='*.spec.ts' \
  --exclude='*.spec.tsx' \
  --exclude='*.snap'; then
  fail 'Forbidden production placeholder/simulation pattern detected.'
fi
printf '[PASS] No forbidden placeholder/simulation patterns in production paths.\n'

printf '\n===== RULE 5: NO TYPESCRIPT ERROR-SUPPRESSION / EXPLICIT ANY ESCAPES =====\n'
TS_ESCAPE_PATTERN='(^|[^[:alnum:]_])as[[:space:]]+any([^[:alnum:]_]|$)|:[[:space:]]*any([^[:alnum:]_]|$)|<any>|@ts-ignore|@ts-nocheck'
if grep -RInE "$TS_ESCAPE_PATTERN" app apps/mobile lib packages components db middleware.ts \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude='*.test.ts' \
  --exclude='*.test.tsx' \
  --exclude='*.spec.ts' \
  --exclude='*.spec.tsx'; then
  fail 'TypeScript escape hatch detected in production code.'
fi
printf '[PASS] No explicit any / ts-ignore escape hatches in production TypeScript.\n'

printf '\n===== RULE 6: SECRET LEAK CHECK =====\n'
if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$'; then
  fail 'Tracked environment/secret file detected. Only .env.example may be tracked.'
fi

SECRET_PATTERN='(sk_live_[A-Za-z0-9]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|STRIPE_WEBHOOK_SECRET=[^[:space:]]+|STRIPE_SECRET_KEY=[^[:space:]]+)'
if git grep -nEI "$SECRET_PATTERN" -- ':!pnpm-lock.yaml' ':!package-lock.json' ':!*.snap' ':!.env.example'; then
  fail 'Credential-like material detected in tracked source.'
fi
printf '[PASS] No tracked env files or obvious credential patterns.\n'

command -v pnpm >/dev/null 2>&1 || fail 'pnpm is not installed.'

run 'ROOT TYPECHECK' pnpm typecheck
run 'MOBILE TYPECHECK' pnpm --filter @liora/mobile typecheck
run 'ROOT LINT' pnpm lint
run 'MOBILE LINT' pnpm --filter @liora/mobile lint
run 'UNIT / DETECTION TESTS' pnpm test
run 'OPTICAL CLASSIFIER REGRESSION TESTS' node --import tsx --test lib/optical-classifier.test.ts
run 'SECURITY TESTS' pnpm test:security
run 'ROOT BUILD' pnpm build

printf '\n===== RULE 8: MOBILE PACKAGE CHECK =====\n'
run 'MOBILE OPTICAL TESTS' pnpm --filter @liora/mobile test -- --runInBand

printf '\n========================================\n'
printf '[PASS] STATIC + TEST + BUILD GATES PASSED\n'
printf '========================================\n'
printf '%s\n' 'NOTE: physical-device gates remain mandatory for camera, BLE, magnetometer, network and release APK/IPA.'
