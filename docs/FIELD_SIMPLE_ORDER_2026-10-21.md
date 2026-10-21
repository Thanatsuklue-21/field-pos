# Simple order screen — 21 October 2026

User-approved bounded design: available menus first, less repeated instruction, clear cart controls and one primary payment action per responsive surface; retain FIELD branding and all financial/stock rules.

## Implementation

- Stable partition of the currently filtered menu places available products first, retaining original order within available/unavailable groups and never mutating bootstrap data. Disabled products remain visible with their existing shortage guidance; none becomes sellable through sorting.
- Remove the duplicate heading subtitle and large step card. A compact, noninteractive three-step strip keeps the active step accessible through `aria-current="step"`. Normal ordering shows one contextual sentence. Higher-priority workspace tasks, storage errors and all-unavailable guidance retain their existing visibility rules.
- Increase product-name type size. Existing product-card touch targets, price formatting, direct-add/variant flow, cart quantities and payment confirmation are unchanged.
- Rename the header's held-bill retrieval to “บิลที่พักไว้”. The separate “พักบิล” action continues to hold the current cart; the two different actions no longer share the same visible name.

## Verification

The new partition test covers mixed/empty/all-unavailable lists, stable group order, object identity and frozen input. The existing nine-viewport quick-work browser suite now injects an unavailable product first and requires the displayed first product to be available, disabled products to remain disabled, the clearly named held-bill entry and no duplicate normal guidance. It retains exact checkout payload/ACK, variant, cart recovery, empty catalog, stock entry and no-live-write checks. Cashier-flow text expectations follow the new single actionable instruction. Step source assertions now check the accessible container rather than obsolete card classes; all higher-priority task assertions remain.

The browser ordering regression failed on the preceding production build before passing on the candidate. Review found no material findings. Final local backend run: 850/850; production build passed. All sixteen browser suites and exact-head CI must pass before release; release uses a separate marker-only PR.

Screenshots/logs are in the task's `simple-order-audit-20261021` folder and adjacent `simple-order-*.log` files. Early parallel Windows native test-process exits remain recorded; no application assertions or safety rules were relaxed to address those exits.

## Limits

This changes presentation, not sale pricing, stock availability, permissions or accounting. Mocked tap-path counts remain four/five for exact-cash single/multivariant fixtures, excluding typing, review and post-sale handoff. It does not establish measured human first-use success, physical Android/PWA keyboard behavior, real provider settlement or a general performance improvement. Owner data and previously documented operating acceptance remain separate.
