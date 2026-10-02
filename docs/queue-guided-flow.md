# FIELD POS guided production flow

Operator flow for the production queue:

1. Follow **ลำดับงานแนะนำ** for the oldest active FIFO order.
2. Tap **รับทำเมนูนี้** to acknowledge the current drink task.
3. Use the same main action to mark **เสร็จแก้ว X/Y**.
4. When a menu is complete, FIELD POS recommends the next menu automatically.
5. A completed menu may be called for early pickup with the physical Bluetooth pager, or staff can wait until the full order is ready.
6. When the full order has been called and handed over, tap **ส่งมอบคิวนี้**.
7. Same-menu batching may be prepared for later queues, but customer calling and final handoff remain FIFO.

The POS only records pager actions. The physical Bluetooth pager base must still be pressed manually.
