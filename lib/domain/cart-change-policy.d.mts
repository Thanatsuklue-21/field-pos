export declare const LOCAL_CART_PROJECTION_MAX_AGE_MS: number;
export type CartChangePlan = {mode: "apply-local"} | {mode: "verify-server"; reason: "no_projection" | "stale_projection" | "local_shortage"};
export declare function planCartChange(input?: {
  next?: Array<{id: string; variant: string; qty: number}>;
  menu?: unknown[] | null;
  stock?: Record<string, unknown> | null;
  allowShortage?: boolean;
  projectionAt?: number;
  now?: number;
  maxAgeMs?: number;
}): CartChangePlan;
