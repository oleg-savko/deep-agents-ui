#!/usr/bin/env bash
# Format the file the agent just wrote. Reads hook JSON from stdin. Fail open.
set -u
cd "$(dirname "$0")/.."

input=$(cat || true)
file=$(printf '%s' "$input" | node -e '
  let raw = "";
  process.stdin.on("data", (chunk) => { raw += chunk; });
  process.stdin.on("end", () => {
    try {
      const data = JSON.parse(raw || "{}");
      const path = data.file_path
        || data.tool_input?.file_path
        || data.tool_input?.path
        || "";
      process.stdout.write(String(path));
    } catch {
      process.stdout.write("");
    }
  });
')

if [[ -z "$file" ]]; then
  exit 0
fi

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.cjs|*.mjs|*.json|*.css|*.md) ;;
  *) exit 0 ;;
esac

yarn -s prettier --write "$file" >/dev/null 2>&1 || true
exit 0
