#!/usr/bin/env bash
# Install the pinned Mermaid reference that `bun run test:mermaid-modern` and
# the eval:mermaid-* diagnostics read: a clean mermaid-js/mermaid checkout at
# the policy pin (MERMAID_UPSTREAM_DIR, default ../mermaid) and an independent
# npm install of the same mermaid and @mermaid-js/parser releases plus jsdom
# (MERMAID_REFERENCE_DIR, default ../mermaid-reference). The pin is
# docs/project/upstream-mermaid-policy.json; the modern-mermaid workflow runs
# this script with $RUNNER_TEMP destinations.
#
# Re-running is cheap: a clean checkout already at the pin and an install whose
# versions already match are left alone. An existing checkout is moved to the
# pin in place, never deleted, and a destination that is not ours (another
# checkout, or an npm project declaring other packages) is refused.
set -euo pipefail
# A caller's CDPATH could otherwise redirect the `cd` that locates the repo.
unset CDPATH

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
PARENT=$(cd "$ROOT/.." && pwd)
POLICY="$ROOT/docs/project/upstream-mermaid-policy.json"
REPO_URL=https://github.com/mermaid-js/mermaid.git
JSDOM_VERSION=26.1.0
UPSTREAM=${MERMAID_UPSTREAM_DIR:-$PARENT/mermaid}
REFERENCE=${MERMAID_REFERENCE_DIR:-$PARENT/mermaid-reference}
case $UPSTREAM in /*) ;; *) UPSTREAM="$PWD/$UPSTREAM" ;; esac
case $REFERENCE in /*) ;; *) REFERENCE="$PWD/$REFERENCE" ;; esac
# Mermaid tracks no LFS content; skipping smudge keeps LFS proxies out of the clone.
export GIT_LFS_SKIP_SMUDGE=1

die() {
  echo "setup-mermaid-reference: $*" >&2
  exit 1
}

# json_field FILE KEY.PATH prints a string field, or nothing when absent.
json_field() {
  bun -e '
    import { existsSync, readFileSync } from "node:fs"
    const [file, path] = process.argv.slice(1)
    let value = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined
    for (const key of path.split(".")) value = value?.[key]
    if (typeof value === "string") process.stdout.write(value)
  ' "$1" "$2"
}

nonempty_dir() {
  [ -d "$1" ] && [ -n "$(ls -A "$1")" ]
}

VERSION=$(json_field "$POLICY" pin.version)
COMMIT=$(json_field "$POLICY" pin.commit)
[ -n "$VERSION" ] && [ -n "$COMMIT" ] || die "$POLICY has no pin.version/pin.commit"
TAG="mermaid@$VERSION"

# --- Upstream source checkout -------------------------------------------------
up() { git -C "$UPSTREAM" "$@"; }

if [ -e "$UPSTREAM" ] && ! [ -d "$UPSTREAM" ]; then
  die "$UPSTREAM exists and is not a directory"
fi
if nonempty_dir "$UPSTREAM"; then
  toplevel=$(up rev-parse --show-toplevel 2>/dev/null || true)
  origin=$(up remote get-url origin 2>/dev/null || true)
  if [ "$toplevel" != "$(cd "$UPSTREAM" && pwd -P)" ]; then
    die "$UPSTREAM is not empty and is not the root of a git checkout; move it or set MERMAID_UPSTREAM_DIR"
  fi
  case $origin in
    *[/:]mermaid-js/mermaid | *[/:]mermaid-js/mermaid.git) ;;
    *) die "$UPSTREAM is a checkout of '${origin:-no origin}', not mermaid-js/mermaid; move it or set MERMAID_UPSTREAM_DIR" ;;
  esac
  if [ "$(up rev-parse HEAD 2>/dev/null || true)" = "$COMMIT" ] && [ -z "$(up status --porcelain)" ] &&
    up tag --points-at HEAD | grep -qxF "$TAG"; then
    echo "Mermaid source already at $TAG ($COMMIT)"
  else
    [ -z "$(up status --porcelain)" ] || die "$UPSTREAM has local changes; commit, stash or discard them first"
    echo "Moving $UPSTREAM to $TAG"
    depth=()
    [ "$(up rev-parse --is-shallow-repository)" = true ] && depth=(--depth 1)
    up fetch --no-tags ${depth[@]+"${depth[@]}"} "$REPO_URL" "+refs/tags/$TAG:refs/tags/$TAG"
  fi
else
  echo "Cloning $TAG into $UPSTREAM"
  git -c advice.detachedHead=false clone --depth 1 --single-branch --branch "$TAG" "$REPO_URL" "$UPSTREAM"
fi

if ! up cat-file -e "$COMMIT^{commit}" 2>/dev/null; then
  echo "Release tag $TAG does not contain the pinned commit; fetching $COMMIT"
  up fetch --no-tags --depth 1 "$REPO_URL" "$COMMIT"
fi
if [ "$(up rev-parse HEAD)" != "$COMMIT" ]; then
  up -c advice.detachedHead=false checkout --detach "$COMMIT"
fi
head=$(up rev-parse HEAD)
[ "$head" = "$COMMIT" ] || die "$UPSTREAM HEAD is $head, expected the pinned $COMMIT"
# eval/mermaid-modern-compat/reference.ts admits a checkout only at its release tag.
if ! up tag --points-at HEAD | grep -qxF "$TAG"; then
  die "release tag $TAG is at $(up rev-parse -q --verify "$TAG^{commit}" || echo nothing), not the pinned $COMMIT; update the pin in $POLICY"
fi
PARSER_VERSION=$(json_field "$UPSTREAM/packages/parser/package.json" version)
[ -n "$PARSER_VERSION" ] || die "$UPSTREAM/packages/parser/package.json has no version"

# --- Independent npm reference --------------------------------------------------
# Resolve the installed versions the way reference.ts does, parser via mermaid.
installed_versions() {
  node -e '
    const { createRequire } = require("node:module")
    const { existsSync, readFileSync } = require("node:fs")
    const { join } = require("node:path")
    const version = file => JSON.parse(readFileSync(file, "utf8")).version
    try {
      const reference = createRequire(join(process.argv[1], "package.json"))
      const mermaid = reference.resolve("mermaid/package.json")
      const parser = createRequire(mermaid).resolve.paths("@mermaid-js/parser")
        .map(directory => join(directory, "@mermaid-js/parser/package.json")).find(existsSync)
      process.stdout.write([version(mermaid), parser ? version(parser) : "-", version(reference.resolve("jsdom/package.json"))].join(" "))
    } catch {}
  ' "$REFERENCE"
}

# An npm prefix is ours only if it declares nothing but the reference packages.
foreign_dependencies() {
  node -e '
    const { readFileSync } = require("node:fs")
    const manifest = JSON.parse(readFileSync(process.argv[1], "utf8"))
    const ours = new Set(["mermaid", "@mermaid-js/parser", "jsdom"])
    const declared = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]
      .flatMap(field => Object.keys(manifest[field] ?? {}))
    process.stdout.write(declared.filter(name => !ours.has(name)).join(" "))
  ' "$1"
}

expected="$VERSION $PARSER_VERSION $JSDOM_VERSION"
# `npm ls --all` also catches a tree an interrupted install left incomplete.
if [ "$(installed_versions)" = "$expected" ] && npm ls --prefix "$REFERENCE" --all >/dev/null 2>&1; then
  echo "Mermaid reference already installed"
else
  if [ -e "$REFERENCE" ] && ! [ -d "$REFERENCE" ]; then
    die "$REFERENCE exists and is not a directory"
  fi
  if nonempty_dir "$REFERENCE" && ! [ -f "$REFERENCE/package.json" ]; then
    die "$REFERENCE is not empty and is not an npm prefix; move it or set MERMAID_REFERENCE_DIR"
  fi
  if [ -f "$REFERENCE/package.json" ]; then
    foreign=$(foreign_dependencies "$REFERENCE/package.json" 2>/dev/null) \
      || die "$REFERENCE/package.json is not readable JSON; move it or set MERMAID_REFERENCE_DIR"
    [ -z "$foreign" ] || die "$REFERENCE is another npm project (it declares $foreign); move it or set MERMAID_REFERENCE_DIR"
  fi
  mkdir -p "$REFERENCE"
  npm install --prefix "$REFERENCE" --save-exact --no-audit --no-fund --ignore-scripts \
    "mermaid@$VERSION" "@mermaid-js/parser@$PARSER_VERSION" "jsdom@$JSDOM_VERSION"
  actual=$(installed_versions)
  [ "$actual" = "$expected" ] || die "$REFERENCE resolves mermaid/parser/jsdom '${actual:-none}', expected '$expected'"
fi

echo "MERMAID_UPSTREAM_DIR=$UPSTREAM  ($TAG at $COMMIT)"
echo "MERMAID_REFERENCE_DIR=$REFERENCE  (mermaid $VERSION, @mermaid-js/parser $PARSER_VERSION, jsdom $JSDOM_VERSION)"
