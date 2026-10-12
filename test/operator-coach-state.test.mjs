import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {operatorCoachSeenKey,shouldAutoOpenOperatorCoach} from "../lib/operator-coach-state.mjs";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("operator coach seen state is scoped per operator and screen",()=>{
  const aPos=operatorCoachSeenKey({operatorId:"user-a",mode:"pos"});
  const aQueue=operatorCoachSeenKey({operatorId:"user-a",mode:"queue"});
  const bPos=operatorCoachSeenKey({operatorId:"user-b",mode:"pos"});
  assert.notEqual(aPos,aQueue);
  assert.notEqual(aPos,bPos);
  assert.match(aPos,/field-operator-coach-v3/);
});

test("operator coach auto opens only for unseen known operators while idle",()=>{
  const key=operatorCoachSeenKey({operatorId:"user-a",mode:"pos"});
  assert.equal(shouldAutoOpenOperatorCoach({seenKey:key,seenValue:null,busy:false,hasGuide:true}),true);
  assert.equal(shouldAutoOpenOperatorCoach({seenKey:key,seenValue:"seen",busy:false,hasGuide:true}),false);
  assert.equal(shouldAutoOpenOperatorCoach({seenKey:key,seenValue:null,busy:true,hasGuide:true}),false);
  assert.equal(shouldAutoOpenOperatorCoach({seenKey:"",seenValue:null,busy:false,hasGuide:true}),false);
});

test("app shell passes the authenticated operator id into the coach",async()=>{
  const shell=await read("components/app-shell.tsx");
  const coach=await read("components/operator-coach.tsx");
  assert.match(shell,/OperatorCoach operatorId=\{session\?\.user\.id\}/);
  assert.match(coach,/operatorCoachSeenKey/);
  assert.match(coach,/shouldAutoOpenOperatorCoach/);
});
