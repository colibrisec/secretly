#!/usr/bin/env bash
set -uo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
next_version="${script_directory}/next-version.sh"
failures=0

expect_version() {
  local description=$1
  local expected=$2
  shift 2
  local actual
  actual=$("$next_version" "$@" 2>/dev/null) || actual="exit $?"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: ${description}: expected '${expected}', got '${actual}'"
    failures=$((failures + 1))
  fi
}

expect_failure() {
  local description=$1
  shift
  if "$next_version" "$@" >/dev/null 2>&1; then
    echo "FAIL: ${description}: expected a non-zero exit"
    failures=$((failures + 1))
  fi
}

expect_version "first release without tags" v1.0.0 "" minor
expect_version "first release ignores the bump" v1.0.0 "" major
expect_version "patch bump" v1.4.2 v1.4.1 patch
expect_version "minor bump resets patch" v1.5.0 v1.4.7 minor
expect_version "major bump resets minor and patch" v2.0.0 v1.4.7 major
expect_version "default bump is patch" v1.4.2 v1.4.1
expect_version "components compare numerically" v1.10.0 v1.9.9 minor
expect_version "leading zeros are decimal" v1.9.0 v1.08.5 minor
expect_failure "rejects a pre-release tag" v1.0.0-rc.1 patch
expect_failure "rejects an unknown bump" v1.0.0 sideways

if [ "$failures" -ne 0 ]; then
  exit 1
fi

echo "next-version: all cases passed"
