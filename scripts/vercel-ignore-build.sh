#!/usr/bin/env bash
set -u

branch="${VERCEL_GIT_COMMIT_REF:-}"

# Production must always build.
if [ "$branch" = "main" ]; then
  exit 1
fi

# FIELD PWA previews are intentionally opt-in while Hobby deployment quota is constrained.
# Add .vercel-preview-release to the exact frozen release-candidate commit to allow one Preview.
if [ "$branch" = "feat/pwa-app-shell" ] && [ -f ".vercel-preview-release" ]; then
  exit 1
fi

# Exit 0 tells Vercel to skip this Git deployment.
exit 0
