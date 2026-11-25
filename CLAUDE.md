# CLAUDE.md — FIELD Café POS

Claude Code reads this file at the start of every session. Keep it short and current. When a decision below changes, update this file in the same PR.

## What this is
FIELD Café POS: a single-shop POS for FIELD, a **solo-run** drink shop in Lat Lum Kaeo, Pathum Thani. The UI is Thai.

- Stack: Next.js 16 + React 19 (`app/`), Vercel Functions, Turso/libSQL, Zustand (`stores/`), Tailwind 4.
- Front-of-house devices are Android phones and tablets. The app stays a PWA, not a native app.

## Read first (they win over this file when they are newer)
1. `README.md` — operating flow, setup, deployment.
2. `docs/FIELD_INFORMATION_AUTHORITY.md` — source-of-truth rules and status labels.
3. The docs for the area you are touching: `docs/FIFO_STOCK_2026-10-31.md`, `docs/PROMPTPAY_DIRECT_MACRODROID.md`, `docs/INTEGRATION_AUDIT.md`, and the matching `*_HANDOFF.md`.

Older audits in `docs/` are dated snapshots, not todo lists. Check the actual code before you treat a past issue as still open.

## Commands
- `npm ci` → `npm test` (node --test, real libSQL file tests) → `npm run build`
- `npm run dev` for local work.
- CI: `.github/workflows/ci.yml`. Prod smoke: `production-smoke.yml`.

## Release rules (do not skip)
- Vercel builds production **only** when `.vercel-release` changes on `main`, per the `vercel.json` ignoreCommand. A normal merge does not deploy.
- Report status with separate labels: `CODE MERGED`, `CI PASSED`, `DEPLOYED`, `PRODUCTION READ VERIFIED`, `OWNER ACCEPTED`.
- Never say the POS is GO-LIVE or "done" without owner acceptance. A passing backend test does not prove real checkout, the payment provider, Android devices or the pager work.
- If you cannot verify something, write `NOT VERIFIED`. Never invent a success.

## Money, stock and order integrity (never weaken)
- The server is authoritative.
  - Checkout re-validates menu, price and stock, and commits sale + stock ledger + cost snapshot + loyalty + queue in **one** write transaction.
  - Money can carry satang (e.g. 55.50). Never round money labels with `toFixed(0)`. See `docs/FIELD_POS_SATANG_HANDOFF.md`.
- Durable request keys (`field_pos_requests`) are idempotency.
  - Never reuse a key with changed input.
  - On an ambiguous network result, reconcile with the original key. Never create a second bill.
- PromptPay is payment-first. Showing a QR never marks a bill paid.
- Current direct flow (owner-approved 2026-11-16): the shop's own Krungsri PromptPay.
  - MacroDroid forwards the bank notification, and the server matches it to exactly one pending QR of that amount before closing the bill.
  - The rules in `docs/PROMPTPAY_DIRECT_MACRODROID.md` must not change without owner approval. Examples: one QR per amount, 15-minute expiry, never store raw notification text (PDPA).
  - Beam/Opn code is a legacy fallback.
- FIFO stock: a precheck does not reserve stock, so checkout must recheck. Do not add a parallel stock balance.
- Queue calls and handoff enforce FIFO on the server.
- Close day needs counted cash, no unfinished orders and no unresolved payments.
- Keep all credentials server-side. Never commit `.env`, keys, backups or customer data. The repo is public.

## Shop decisions the code must follow (owner-approved, Nov 2026)
- **Sweetness labels:** `หวาน` (100%) · `หวานน้อย` (50%) · `ไม่หวาน` (0%).
  - Do **not** show the word "ปกติ". `lib/domain/quick-order.mjs` still accepts it only as legacy input mapped to `หวาน`.
  - Americano (iced or hot) and Pure Matcha: ask the customer every cup. `ไม่หวาน` = no syrup.
  - Cocoa, soda and coconut drinks have one sweetness level only, with no choice.
- **Opening menu: 12 drinks.** All iced except hot Americano. One 16 oz cup size; no S/M/L. No blended drinks.

  | Drink | Price (THB) |
  |---|---|
  | อเมริกาโน่ | 45 |
  | ลาเต้ | 60 |
  | เอสเย็น | 60 |
  | กาแฟโบราณ | 45 |
  | ชาใต้ | 50 |
  | เพียวมัทฉะ | 50 |
  | มัทฉะลาเต้ | 60 |
  | มัทฉะมะพร้าว | 60 |
  | อเมริกาโน่มะพร้าว | 60 |
  | โกโก้ | 55 |
  | บ๊วยโซดา | 45 |
  | อเมริกาโน่ร้อน | 40 |

  Prices are set in the admin UI. Do not hard-code them.
- **Pure Matcha:** Yamito **4 g** (SENSORY_LOCKED). The approved-recipes code still suggests 5 g / 180 g. Do not "confirm" or change that recipe until the owner finishes the tasting.
- **Coconut drinks:** Senorita (Mitr Phol) Nam-Hom coconut syrup + water. No fresh coconut water.
- **Ice and dairy:**
  - Tube ice shop-wide. The cup weight used by the app and the POS must match the owner's measured average.
  - Carnation Plus = sweetened condensed milk (นมข้นหวาน), not creamer.
- **Promotions:**
  - No B1G1 and no deep discounts by default.
  - Any promo must leave profit ≥ 25 THB/cup.
  - Never discount กาแฟโบราณ or hot Americano.
- **Solo-operator UX:** as few taps as possible.
  - Quick-add uses the default sweetness.
  - After payment, take the next order first.
  - Counter handoff is one tap.

## Related systems (not in this repo)
- R&D app: `Thanatsuklue-21/FieldRDDrink` (field-rd-drink.vercel.app). Trial data is device-local; it is not truth for the POS.
- Business decisions: the private Google Doc `FIELD_MASTER_CONTROL_LIVE`. Never paste its contents into this public repo.

## Working style
- Reply to the owner in Thai: short, practical, numbers first.
- Make small PRs with tests, one concern per PR.
- Add or adjust a test in `test/` for every behaviour change.
- When sources conflict, mark it `CONFLICT` with dates and stop. Do not guess.
