# FIFO availability and actual sale costs

Base: `e2c9c65635241d946e098ad78df5b2e451141ff5` (main).

## Data and transaction boundaries

Stock remains in the existing `field_state` / `field_stock_transactions` flow.
`loadFifoStock` reconstructs remaining lots from that ledger and existing purchase
records. It does not persist another inventory balance. `receivedAt` is the
receipt stock transaction's `created_at`; the purchase accounting date is not
used to reorder physical receipts. Equal receipt times use purchase lot ID.

POS refreshes the server bootstrap before adding a variant or changing quantity.
The read-only `/api/pos/availability` POST also validates a complete cart against
the server's recipes and stock in one database transaction. Disabled products,
missing recipes and combined ingredient shortages fail that check. A precheck
does not reserve stock and cannot promise that another terminal will not sell it.

Checkout retains the existing write transaction and durable, actor/payload-bound
idempotency ledger. Allocation, stock deduction, provider-charge consumption,
sale/order creation, cost snapshots, audit and request acknowledgement commit
together. A shortage or persistence error rolls all of them back. Offline outbox
reconciliation also rejects shortages; it cannot finalize negative inventory.
The existing outbox keeps rejected fulfilled sales for operator review.

Split payments retain the existing stock reservation lifecycle, with lot plans
pinned per session. Other sales exclude those exact lots. Final payment checks
the reservation again before recording payment. Existing sessions without plans
receive deterministic plans inside the next write transaction. A used or reserved
purchase cannot be edited or cancelled out from under a sale/payment.

## Cost provenance and reporting

Each sale item appends to `field_cost_snapshots` with stable sale-item identity,
order identity, recipe version and full recipe snapshot. The document contains
each ingredient/lot allocation, quantity, receipt time, unit cost, total cost,
source/cost status and consumed time. Original snapshots are never rewritten by
void/refund. A stock-restoring cancellation appends a compensating snapshot that
references the original snapshot and restores its original lots. Refunds after
production retain consumed stock and the existing refund-loss treatment.

`unitCostExact`, `totalCostExact` and `lineCostExact` store reduced rational
numerators/denominators. Quantity arithmetic and cost multiplication use BigInt.
The sale's authoritative `costTotal` rounds the combined exact cost once to
satang, half away from zero. Numeric baht values are serialization/display
boundaries. Consumers must use `sale.costTotal` / exact line costs rather than
reconstructing COGS by multiplying a display-rounded per-cup cost.

Recipe edits and later price edits do not change old COGS. Missing purchase costs
remain MISSING, including an unpriced receipt stored as zero by the old schema;
they are not silently promoted to confirmed free stock. Gross profit continues
to use Net Sales minus Food Cost. No VAT or division by 1.07 is introduced.

## Test stock and opening quantities

The owner confirmed that the current stock is test data. The Stock screen now
lists opening ingredients, quantities and units for review. A successful first
FIFO write freezes opening provenance and its cost basis; that metadata is an
audit snapshot, not another remaining-quantity authority. Unproven legacy opening
costs are explicitly PROVISIONAL, rather than claimed as actual purchase costs.

Before real trading, use the existing guarded test-data reset and actual stock
count/receipt workflow to establish the real opening inventory and confirmed
cost evidence. No test data is deleted automatically by this change. Stock reset
epochs invalidate prior opening snapshots, so test quantities cannot reappear as
the real opening list. Opening lot identities include their reset epoch, so test
and real opening lots cannot be confused in historical provenance. Confirmed
receipt lots remain the actual cost source; subsequent receipts follow them in
FIFO order. Backups already include
the state, stock ledger, purchase records, sessions and cost snapshot documents.

## Verification and release gate

The real-libSQL FIFO tests cover single/multiple lots, ties, exact boundaries,
shared ingredients, cup sizes, prechecks, disabled products, concurrent final
checks, replay, rollback, original-lot reversals, recipe edits, cost precision,
unpriced receipts, split reservations, pre-rollout sessions, purchase cancellation
and opening/reset provenance. The browser test first reproduced a stale-stock
tap enabling payment, then verifies its rejection at 320/360/390/412 px and checks
the visible opening list. All browser API calls are intercepted.

Keep `.vercel-release` unchanged on the feature PR. Run the full suite, production
build and complete browser QA on the final revision. Merge only when CI passes.
Then update the existing release marker on main and verify the deployed exact
commit through `/api/health`, `/pos`, and read-only browser/runtime checks. Do not
exercise a live checkout as a deployment smoke test.
