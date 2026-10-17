import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=p=>readFile(new URL("../"+p,import.meta.url),"utf8");

test("mobile POS keeps routine operations on the same surface",async()=>{
  const shell=await read("components/app-shell.tsx");
  const pos=await read("app/pos/page.tsx");
  assert.match(shell,/posWorkspaceTabs=\{"\/queue":"queue","\/orders":"orders","\/stock":"stock","\/expenses":"expense"\}/);
  assert.match(shell,/field:open-pos-workspace/);
  assert.match(shell,/path==="\/pos"&&href==="\/queue"/);
  assert.match(shell,/>งานร้าน<\/span>/);
  assert.match(shell,/เปิดตรงนี้/);
  assert.match(shell,/aria-label="เมนูหลักบนมือถือ"/);
  assert.match(pos,/window\.addEventListener\("field:open-pos-workspace",openFromShell\)/);
  assert.match(pos,/openWorkspace\(tab\)/);
});

test("POS hides duplicate workspace launcher on phones but keeps it on desktop",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/className="hidden min-h-11[^"]*md:flex[^"]*"><ClipboardList size=\{14\}\/?>งานร้าน<\/button>/);
});

test("order teaching steps do not compete with a higher-priority store task",async()=>{
  const pos=await read("app/pos/page.tsx");
  assert.match(pos,/\{!workspaceActionVisible&&<div className="mb-3 grid grid-cols-3/);
  assert.match(pos,/workspaceNextAction\.label/);
  assert.match(pos,/workspaceActionLabel/);
});

test("new cashier browser gate proves workspace opens without leaving POS",async()=>{
  const qa=await read("scripts/qa-cashier-flow.py");
  assert.match(qa,/get_by_role\("navigation",name="เมนูหลักบนมือถือ"\)/);
  assert.match(qa,/get_by_role\("button",name="งานร้าน",exact=True\)/);
  assert.match(qa,/get_by_role\("dialog",name="งานร้าน FIELD"\)/);
  assert.match(qa,/assert page\.url==before_workspace_url and page\.url\.endswith\("\/pos"\)/);
  assert.match(qa,/"workspaceStayedOnPos":True/);
});
