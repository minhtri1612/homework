#!/usr/bin/env bash
# Releases the Docker image by hand, the same steps GitHub Actions runs
# (.github/workflows/docker.yml), and times each one. Used to compare a manual
# release with the pipeline. Needs `docker login` first.
#   bash scripts/release-manual.sh [tag]   (default tag: manual-test)
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=minhtri16122004/homework
TAG=${1:-manual-test}
TOTAL_START=$(date +%s.%N)

step() {
  local name=$1; shift
  local start=$(date +%s.%N)
  "$@" > /dev/null 2>&1 || { echo "✖ $name failed: $*"; exit 1; }
  printf '%-14s %6.1f s\n' "$name" "$(echo "$(date +%s.%N) - $start" | bc)"
}

step 'npm ci' npm ci
step 'npm test' npm test
step 'docker build' docker build -t "$IMAGE:$TAG" .
step 'docker push' docker push "$IMAGE:$TAG"
printf '%-14s %6.1f s\n' 'total' "$(echo "$(date +%s.%N) - $TOTAL_START" | bc)"
