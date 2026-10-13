#!/usr/bin/env bash
set -u

branch="${VERCEL_GIT_COMMIT_REF:-}"

marker_changed(){
  local path="$1"
  git rev-parse --verify HEAD^ >/dev/null 2>&1 || return 1
  git diff --quiet HEAD^ HEAD -- "$path" >/dev/null 2>&1
  [ "$?" -eq 1 ]
}

# Production deploys are explicit: only the commit that changes .vercel-release may build.
if [ "$branch" = "main" ]; then
  if marker_changed ".vercel-release"; then
    exit 1
  fi
  exit 0
fi

# FIELD PWA previews are also exact-head opt-in.
# Only the commit that changes .vercel-preview-release may build.
if [ "$branch" = "feat/pwa-app-shell" ]; then
  if marker_changed ".vercel-preview-release"; then
    exit 1
  fi
  exit 0
fi

# Other feature/integration branches never consume Vercel Hobby builds automatically.
exit 0
