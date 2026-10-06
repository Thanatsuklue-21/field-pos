# Queue production and pickup

Complete each menu with one tap, then call the order. Once all items are called, the order remains green in the queue overview and the next uncalled order becomes the production head. Waiting for pickup does not block production. Mark a green order "ลูกค้ารับแล้ว" only when the customer receives it. Pickup can happen out of order. The "เรียกอีกครั้ง" button displays the pager reminder without another database write. Staff still press the physical pager; the website does not control it directly.

Production remains FIFO among uncalled orders. Partial calls do not release the production head. Pickup does not release the pager until confirmed and does not change sales or stock. Existing request-key idempotency and expected ready quantity guard repeated actions.

The UI removes the selection round trip and automatic overview popup. Writes retain optimistic feedback and a synchronous duplicate-click lock; stale polling cannot overwrite an active mutation. Queue request, state and audit writes are batched in one transaction. Retry state stores compact responses instead of up to 100 complete queue snapshots. Actual cloud latency still depends on the network and Turso; no measured production latency guarantee is made.

Manual acceptance: create two orders, finish and call the first, leave it green, finish and call the second, collect the second first, then collect the first. Refresh on another device and verify one sale per bill, no extra stock deductions, green queues persist until pickup, and pagers remain reserved while waiting.
