import {cartAvailability} from './availability.mjs';

// How old the in-memory POS stock projection may be before a cart tap must
// wait for a fresh server read. The page refreshes bootstrap every 15s while
// visible, after every sale and on focus, so a 60s window keeps normal taps
// instant while still forcing a read after the device was idle or asleep.
export const LOCAL_CART_PROJECTION_MAX_AGE_MS=60_000;

// Decide whether a cart change can be applied immediately from the local stock
// projection or must wait for an authoritative bootstrap read.
//
// This is UX only. The projection is advisory: precheck never reserves stock,
// payment opening re-checks the cart, and the server checkout transaction
// re-validates product, price, recipe and FIFO stock before committing.
//
// Returns {mode:'apply-local'} when the change is safe to show instantly, or
// {mode:'verify-server', reason} when the page must refresh first.
export function planCartChange({next=[],menu,stock,allowShortage=false,projectionAt,now=Date.now(),maxAgeMs=LOCAL_CART_PROJECTION_MAX_AGE_MS}={}){
  if(!Array.isArray(menu)||!menu.length||!stock||typeof stock!=='object')return {mode:'verify-server',reason:'no_projection'};
  const age=Number(now)-Number(projectionAt);
  if(!Number.isFinite(age)||age<0||age>maxAgeMs)return {mode:'verify-server',reason:'stale_projection'};
  // Removing items or lowering quantity never consumes more stock.
  if(allowShortage)return {mode:'apply-local'};
  const checked=cartAvailability({cart:next,menu,stock});
  // A locally blocked tap is re-checked against the server: the projection may
  // be pessimistic (stock was just received on another device).
  if(!checked.available)return {mode:'verify-server',reason:'local_shortage'};
  return {mode:'apply-local'};
}
