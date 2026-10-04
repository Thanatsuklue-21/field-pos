FIELD CAFÉ POS legacy web assets.

The current production application is the Next.js app under `app/`.
`public/index.html`, `online*.js`, and `fast-ui.js` are retained only as migration/reference fixtures for historical tests and data comparisons.

Production routing redirects their public entry paths to `/pos`. Do not restore them as an operational POS or use their local state as a source of truth.
