export const QUEUE_STATES = Object.freeze({
  WAITING: 'WAITING',
  MAKING: 'MAKING',
  DONE: 'DONE',
  CALLED: 'CALLED',
  SERVED: 'SERVED',
  CLOSED: 'CLOSED',
});

const ALLOWED_TRANSITIONS = Object.freeze({
  [QUEUE_STATES.WAITING]: new Set([QUEUE_STATES.MAKING, QUEUE_STATES.CLOSED]),
  [QUEUE_STATES.MAKING]: new Set([QUEUE_STATES.DONE, QUEUE_STATES.CLOSED]),
  [QUEUE_STATES.DONE]: new Set([QUEUE_STATES.MAKING, QUEUE_STATES.CALLED, QUEUE_STATES.CLOSED]),
  [QUEUE_STATES.CALLED]: new Set([QUEUE_STATES.MAKING, QUEUE_STATES.SERVED, QUEUE_STATES.CLOSED]),
  [QUEUE_STATES.SERVED]: new Set([QUEUE_STATES.MAKING, QUEUE_STATES.CLOSED]),
  [QUEUE_STATES.CLOSED]: new Set(),
});

const LEGACY_STATUS_MAP = Object.freeze({
  assigned: QUEUE_STATES.WAITING,
  waiting: QUEUE_STATES.WAITING,
  making: QUEUE_STATES.MAKING,
  ready: QUEUE_STATES.DONE,
  done: QUEUE_STATES.DONE,
  called: QUEUE_STATES.CALLED,
  served: QUEUE_STATES.SERVED,
  returned: QUEUE_STATES.CLOSED,
  closed: QUEUE_STATES.CLOSED,
});

export function normalizeQueueStatus(status) {
  const raw = String(status ?? '').trim();
  if (Object.values(QUEUE_STATES).includes(raw)) return raw;
  return LEGACY_STATUS_MAP[raw.toLowerCase()] ?? QUEUE_STATES.WAITING;
}

export function mayTransitionQueue(from, to) {
  const source = normalizeQueueStatus(from);
  const target = normalizeQueueStatus(to);
  return source === target || ALLOWED_TRANSITIONS[source]?.has(target) === true;
}

export function transitionQueue(order, to, now = Date.now()) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw new Error('invalid_order');
  const from = normalizeQueueStatus(order.status);
  const target = normalizeQueueStatus(to);
  if (!mayTransitionQueue(from, target)) throw new Error('invalid_queue_transition');

  return {
    ...order,
    status: target,
    queueUpdatedAt: now,
    ...(target === QUEUE_STATES.MAKING ? { makingAt: order.makingAt || now } : {}),
    ...(target === QUEUE_STATES.DONE ? { doneAt: now } : {}),
    ...(target === QUEUE_STATES.CALLED ? { calledAt: now } : {}),
    ...(target === QUEUE_STATES.SERVED ? { servedAt: now } : {}),
    ...(target === QUEUE_STATES.CLOSED ? { closedAt: now } : {}),
  };
}

export function appendItemsToActiveOrder(order, items, now = Date.now()) {
  if (!order || typeof order !== 'object' || Array.isArray(order)) throw new Error('invalid_order');
  if (!Array.isArray(items) || items.length === 0) throw new Error('invalid_items');

  const status = normalizeQueueStatus(order.status);
  if (status === QUEUE_STATES.CLOSED) throw new Error('queue_closed');

  const normalizedItems = items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid_item');
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('invalid_item_qty');
    return {
      ...item,
      qty,
      readyQty: 0,
      calledQty: 0,
      addedAt: now,
    };
  });

  return {
    ...order,
    items: [...(Array.isArray(order.items) ? order.items : []), ...normalizedItems],
    status: status === QUEUE_STATES.WAITING ? QUEUE_STATES.WAITING : QUEUE_STATES.MAKING,
    lastAddedAt: now,
    queueUpdatedAt: now,
  };
}

export function queueDelayLevel(order, now = Date.now()) {
  const startedAt = Number(order?.time ?? order?.createdAt ?? now);
  const safeStartedAt = Number.isFinite(startedAt) ? startedAt : now;
  const minutes = Math.max(0, (now - safeStartedAt) / 60000);
  if (minutes >= 8) return 'critical';
  if (minutes >= 5) return 'warning';
  if (minutes >= 3) return 'watch';
  return 'normal';
}
