#!/usr/bin/env bash
# Run typecheck, eslint, and related unit tests on the files this turn touched.
# --cursor prints a followup_message JSON object (exit 0).
# --claude writes the failure tail to stderr and exits 2.
set -u
cd "$(dirname "$0")/.."

mode="claude"
if [[ "${1:-}" == "--cursor" ]]; then
  mode="cursor"
fi

input=$(cat || true)
if [[ -n "$input" ]]; then
  active=$(printf '%s' "$input" | node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        process.stdout.write(JSON.parse(raw).stop_hook_active ? "1" : "0");
      } catch {
        process.stdout.write("0");
      }
    });
  ')
  if [[ "$active" == "1" ]]; then
    exit 0
  fi
fi

if [[ "${AGENT_CHECK:-1}" == "0" ]]; then
  exit 0
fi

files=$(
  {
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } | grep -E '(^|/)src/.*\.(ts|tsx)$' | sed 's#^deep-agents-ui/##' | sort -u || true
)

if [[ -z "${files}" ]]; then
  exit 0
fi

log=$(mktemp)
fail=0
yarn -s typecheck >"$log" 2>&1 || fail=1
if [[ "$fail" -eq 0 ]]; then
  # shellcheck disable=SC2086
  yarn -s eslint $files >>"$log" 2>&1 || fail=1
fi
if [[ "$fail" -eq 0 ]]; then
  # shellcheck disable=SC2086
  yarn -s vitest related --run $files >>"$log" 2>&1 || fail=1
fi

if [[ "$fail" -eq 0 ]]; then
  rm -f "$log"
  exit 0
fi

tail=$(tail -n 60 "$log")
rm -f "$log"
message="Checks failed:
${tail}
Fix them. Do not delete, skip, or loosen tests to get a green run."

if [[ "$mode" == "cursor" ]]; then
  node -e 'process.stdout.write(JSON.stringify({ followup_message: process.argv[1] }))' "$message"
  exit 0
fi

printf '%s\n' "$message" >&2
exit 2
