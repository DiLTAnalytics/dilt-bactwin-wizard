#!/usr/bin/env bash
# Downloads the packages of a release build and deletes the build's artifacts on GitHub right after.
# Usage: scripts/fetch-release.sh <tag> [folder]   Needs gh with write access to the repository.

set -euo pipefail

tag="${1:?usage: scripts/fetch-release.sh <tag> [folder]}"
dest="${2:-bactwin-wizard-$tag}"

run="$(gh run list --workflow release.yml --branch "$tag" --status success --limit 1 --json databaseId -q '.[0].databaseId')"
[ -n "$run" ] || { echo "No successful release build for $tag." >&2; exit 1; }

gh run download "$run" --name "bactwin-wizard-$tag" --dir "$dest"
for id in $(gh api "repos/{owner}/{repo}/actions/runs/$run/artifacts" -q '.artifacts[].id'); do
  gh api -X DELETE "repos/{owner}/{repo}/actions/artifacts/$id"
done

# macOS has shasum, Linux and Git Bash sha256sum.
if command -v sha256sum > /dev/null; then (cd "$dest" && sha256sum -c SHA256SUMS); else (cd "$dest" && shasum -a 256 -c SHA256SUMS); fi
echo "Packages in $dest; the artifacts on GitHub are deleted."
