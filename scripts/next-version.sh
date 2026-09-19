#!/usr/bin/env bash
set -euo pipefail

latest_tag="${1:-}"
bump="${2:-patch}"

if [ -z "$latest_tag" ]; then
  echo "v1.0.0"
  exit 0
fi

if ! [[ "$latest_tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "unsupported tag format: ${latest_tag}" >&2
  exit 1
fi

major=$((10#${BASH_REMATCH[1]}))
minor=$((10#${BASH_REMATCH[2]}))
patch=$((10#${BASH_REMATCH[3]}))

case "$bump" in
  major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
  minor)
    minor=$((minor + 1))
    patch=0
    ;;
  patch)
    patch=$((patch + 1))
    ;;
  *)
    echo "unknown bump: ${bump}" >&2
    exit 1
    ;;
esac

echo "v${major}.${minor}.${patch}"
