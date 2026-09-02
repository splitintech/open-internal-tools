#!/usr/bin/env bash
# Create a signed release tag for an npm product folder.
# Usage (from repo root):
#   scripts/create-release-tag.sh in-app-otp
#   scripts/create-release-tag.sh react-mobile-interactions
#   scripts/create-release-tag.sh verification-adapter-sdk
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

product="${1:-}"
case "$product" in
  in-app-otp|react-mobile-interactions|verification-adapter-sdk) ;;
  *)
    echo "Usage: $0 <in-app-otp|react-mobile-interactions|verification-adapter-sdk>" >&2
    exit 1
    ;;
esac

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash before tagging." >&2
  exit 1
fi

version="$(node -p "require('./${product}/package.json').version")"
tag="${product}-v${version}"

if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "Tag $tag already exists." >&2
  exit 1
fi

assert_args=(--tag "$tag" --prefix "${product}-v")
if [[ "$product" == "verification-adapter-sdk" ]]; then
  assert_args+=(--workspace-root verification-adapter-sdk)
else
  assert_args+=(--package "${product}/package.json")
fi
node "$root/scripts/assert-release-tag.mjs" "${assert_args[@]}"

message="${product} ${version}"

if git tag -s "$tag" -m "$message"; then
  echo "Created signed tag $tag"
else
  echo "git tag -s failed. Configure GPG or SSH signing, then retry." >&2
  echo "  git config --global user.signingkey <key>" >&2
  echo "  git config --global tag.gpgSign true" >&2
  exit 1
fi

echo "Push the tag to run OIDC publish + GitHub Release:"
echo "  git push origin $tag"
