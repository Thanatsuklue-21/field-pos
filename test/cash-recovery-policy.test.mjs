import test from "node:test";
import assert from "node:assert/strict";
import {shouldRetainCashPending} from "../lib/cash-recovery-policy.mjs";

test("cash recovery retains pending for transport and unknown failures",()=>{
  for(const error of [
    new Error("network_unavailable"),
    Object.assign(new Error("offline_write_blocked"),{status:0}),
    Object.assign(new Error("offline_session_revalidation"),{status:409}),
    Object.assign(new Error("socket_reset"),{status:0}),
    new Error("unexpected_transport_failure")
  ]) assert.equal(shouldRetainCashPending(error),true,error.message);
});

test("cash recovery retains pending for auth, throttling and server failures",()=>{
  for(const status of [401,403,408,425,429,500,502,503,504]){
    assert.equal(shouldRetainCashPending(Object.assign(new Error("request_failed"),{status})),true,String(status));
  }
});

test("cash recovery clears only authoritative non-retryable client rejections",()=>{
  for(const status of [400,404,409,410,422]){
    assert.equal(shouldRetainCashPending(Object.assign(new Error("business_rejected"),{status})),false,String(status));
  }
});
