# Backup preview action guards — 2026-10-18

Baseline: exact `origin/main c863aaf5f3e2c670a17220f3213f4cca57479444`.
Branch: `fix/backup-preview-action-guards-20261018`.

## Evidence and change

`app/backup/page.tsx` published a restore preview before `/api/state/meta`
completed, retained the previous file's confirmation when selecting another file,
and allowed overlapping file inspections. A failed metadata request left a
candidate visible. Export failures also escaped without a handled error message.

- Serialize inspect/export/restore with a synchronous ref and disabled controls.
- Reset candidate, revision and confirmation when inspecting a file.
- Publish a new candidate only after a nonnegative safe-integer revision arrives.
- Keep pending restore identity/revision and exact ACK behavior unchanged.
- Allow selecting the same file again after a failed inspection.
- Catch export errors and show operator-safe Thai guidance.

No backend, database, permission or accounting rules changed.

## Validation

- `npm ci --no-audit --no-fund`: passed.
- `npm test`: 744 passed, zero failures/skips/cancellations.
- `npm run build`: passed compilation, TypeScript and route generation.
- `git diff --check`: passed.
- Production-build Chromium UI regression: 320×640, 390×844, 768×1024.
  All passed: held metadata blocks restore/selection; changing files resets
  confirmation; failed/malformed metadata leaves no candidate; pending restore
  locks controls; truncated response → reload → mismatched file blocked → same
  file exact replay; export failure handled. No page errors or document overflow.
- Added `scripts/qa-backup-preview.py` to the existing CI browser gate.
- Before/after regression: the same browser script fails against exact baseline
  in an isolated worktree because the file input remains enabled during held
  metadata. It passes against the patched production build.

Reproduce after build/start:
`python scripts/qa-backup-preview.py --base-url http://127.0.0.1:3000`.
Optional `--browser /path/to/chromium` selects a local executable.

All browser APIs are mocked. This does not validate production database restore,
Android hardware or live payments. CI/merge/deployment identity must be checked
on GitHub before release; do not infer deployment from local checks.

## Publication blocker

Automatic approval review rejected the attempted push to the public GitHub
repository because explicit authorization to publish this payload was required.
The change is committed locally only. No new PR, remote CI result or deployment
is claimed. Obtain explicit publication approval before retrying the push.
