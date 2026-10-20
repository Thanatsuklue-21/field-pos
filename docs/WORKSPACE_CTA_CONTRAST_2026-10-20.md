# Workspace recommendation and button contrast fix — 20 October 2026

Base: exact latest main/production `f1d0525badcd36f6a2917d52d30abac749610596`.

The supplied screenshots show dark labels on green primary actions and a stock recommendation above an already selected stock tab. The unlayered control reset overrode Tailwind foreground utilities. The stock CTA selected that same tab, making its effect imperceptible.

Move the control reset into Tailwind's base layer and define explicit FIELD green/gold/disabled foreground/background tokens. Workspace disabled controls retain full opacity and readable labels. Workspace controls retain a 44px minimum target.

The stock recommendation now reveals a focused guidance section inside the existing modal, listing affected menus and missing ingredients with a stock receiving/counting link. It opens even if stock is already selected. CTA rendering and dispatch check allowed tabs; states without actions keep their explanatory recommendation and no action button. No payment, stock mutation, accounting or permission rules changed.

Validation:
- New regression tests failed on baseline and pass after the fix.
- npm ci completed from the unchanged lockfile.
- npm test: 825/825 passed.
- npm run build: passed on Node 24 (native build required outside filesystem sandbox).
- All nine existing repository production-build browser QA scripts passed with intercepted APIs.
- New browser QA covers 320/360/390/412/768px and mouse/touch/Enter/Space; same-tab stock CTA reveals and focuses guidance, exposes missing milk and a real stock link, and causes no business writes/page errors. It measures computed green/gold/disabled contrast after transitions.
- CI runs the new browser regression before the existing QA suite.

Production release must use the existing separate `.vercel-release` marker gate after exact-head CI passes. Local intercepted browser results do not represent live stock or financial transactions.
