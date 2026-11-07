#!/usr/bin/env bash
#
# Push the console's production configuration from Doppler into Vercel.
#
#   deploy/doppler-sync.sh            # dry run: key names and changed/unchanged, nothing changes
#   deploy/doppler-sync.sh --apply    # set the changed keys in Vercel production, then redeploy if any changed
#
# Doppler (project macp-ui-console, config prd) is the source of truth for the
# keys listed in deploy/doppler-keys.txt, and only those, in the Vercel
# project zer07labs/ui-console, Production environment. The script sets and
# updates them; it never removes a Vercel variable, never touches a key
# outside the list, and never touches Preview or Development values. A key
# whose production entry is shared with another environment is refused.
#
# Values are piped from Doppler into Vercel and are never printed or written
# to disk. Vercel holds no Doppler token.
#
# Needs git, jq, curl and the doppler and vercel CLIs, logged in. Refuses to
# run on a dirty working tree, so what runs is what is committed.
set -euo pipefail

VERCEL_TEAM=zer07labs
VERCEL_TEAM_ID=team_hCHZb89wQ6E3IV3p9Lafq5Sp
VERCEL_PROJECT=ui-console
VERCEL_PROJECT_ID=prj_qja6dxkBj4qjIV3jrYOkkU8ZTFU4
DOPPLER_PROJECT=macp-ui-console
DOPPLER_CONFIG=prd

mode=dry-run
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) mode=dry-run ;;
    --apply) mode=apply ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*" >&2; }
die() { say "doppler-sync: $*"; exit 1; }

for c in git jq curl doppler vercel; do
  command -v "$c" >/dev/null || die "needs $c on PATH"
done
repo="$(git rev-parse --show-toplevel)"
[ -z "$(git -C "$repo" status --porcelain)" ] || die "working tree is dirty; commit or stash first"
doppler me >/dev/null 2>&1 || die "doppler is not logged in (doppler login)"
vercel whoami >/dev/null 2>&1 || die "vercel is not logged in (vercel login)"

keys_file="$repo/deploy/doppler-keys.txt"
[ -f "$keys_file" ] || die "missing $keys_file"
keys="$(sed -e 's/#.*//' -e 's/[[:space:]]//g' "$keys_file" | grep -v '^$' || true)"
[ -n "$keys" ] || die "no keys in $keys_file"

vercel_token() {
  if [ -n "${VERCEL_TOKEN:-}" ]; then printf '%s' "$VERCEL_TOKEN"; return; fi
  local f
  for f in "$HOME/Library/Application Support/com.vercel.cli/auth.json" \
    "${XDG_DATA_HOME:-$HOME/.local/share}/com.vercel.cli/auth.json"; do
    [ -f "$f" ] && { jq -r '.token' "$f"; return; }
  done
  die "no Vercel token (set VERCEL_TOKEN or run vercel login)"
}
vercel_api() {
  curl -fsS "https://api.vercel.com$1" -H "Authorization: Bearer $(vercel_token)"
}

# The Production entries as {KEY: {value, shared}}: the list endpoint returns
# encrypted values, so each entry is read back decrypted by id. shared is true
# when the entry also targets Preview or Development.
vercel_vars() {
  local entries id
  entries="$(vercel_api "/v9/projects/$VERCEL_PROJECT_ID/env?teamId=$VERCEL_TEAM_ID" |
    jq -c '[.envs[] | select((.target // []) | index("production")) | select(.gitBranch == null)
            | {id, key, type, shared: ((.target | length) > 1)}]')"
  {
    for id in $(jq -r '.[].id' <<<"$entries"); do
      vercel_api "/v1/projects/$VERCEL_PROJECT_ID/env/$id?teamId=$VERCEL_TEAM_ID" | jq -c '{id, value}'
    done
  } | jq -sc --argjson e "$entries" '
    (map({(.id): .value}) | add // {}) as $v |
    $e | map({(.key): {value: $v[.id], type, shared}}) | add // {}'
}
doppler_vars() {
  doppler secrets download --no-file --format json --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG"
}

# One line per key: "<KEY> <state>". Values stay inside jq.
plan() {
  jq -nr --slurpfile d <(doppler_vars) --slurpfile v <(vercel_vars) --arg keys "$keys" '
    $d[0] as $d | $v[0] as $v |
    $keys | split("\n")[] | . as $k |
    if ($d | has($k) | not) then "\($k) missing-in-doppler"
    elif ($v | has($k) | not) then "\($k) new"
    elif $v[$k].type == "sensitive" then "\($k) sensitive-unreadable"
    elif $v[$k].shared then "\($k) shared-with-other-environments"
    elif $v[$k].value == $d[$k] then "\($k) unchanged"
    else "\($k) changed" end'
}

result="$(plan)"
say "Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG -> Vercel $VERCEL_TEAM/$VERCEL_PROJECT (production):"
while read -r k state; do say "  $k: $state"; done <<<"$result"
grep -q ' missing-in-doppler$' <<<"$result" && die "listed keys are missing from Doppler; nothing changed"
grep -q ' shared-with-other-environments$' <<<"$result" && die "split those entries per environment in Vercel first; nothing changed"
grep -q ' sensitive-unreadable$' <<<"$result" && die "sensitive Vercel variables cannot be compared; nothing changed"
todo="$(awk '$2 == "changed" || $2 == "new" {print $1 " " $2}' <<<"$result")"

if [ -z "$todo" ]; then say "in sync; nothing to do"; exit 0; fi
if [ "$mode" = dry-run ]; then say "dry run: $(wc -l <<<"$todo" | tr -d ' ') key(s) would change; --apply to push"; exit 0; fi

while read -r k state; do
  say "setting $k"
  if [ "$state" = new ]; then verb=add; else verb=update; fi
  doppler_vars | jq -j --arg k "$k" '.[$k]' |
    vercel env "$verb" "$k" production --scope "$VERCEL_TEAM" --cwd "$repo" --yes >/dev/null 2>&1 ||
    die "vercel env $verb $k failed"
done <<<"$todo"

after="$(plan)"
if grep -qv ' unchanged$' <<<"$after"; then
  while read -r k state; do say "  $k: $state"; done <<<"$after"
  die "Vercel does not match Doppler after --apply; not redeploying"
fi
latest="$(vercel_api "/v6/deployments?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_TEAM_ID&target=production&state=READY&limit=1" |
  jq -r '.deployments[0].uid // empty')"
[ -n "$latest" ] || die "variables match Doppler, but no production deployment to rebuild; deploy to apply them"
say "variables match Doppler; rebuilding production ($latest), NEXT_PUBLIC_* are build-time"
vercel redeploy "$latest" --target production --scope "$VERCEL_TEAM" --cwd "$repo" >/dev/null
