import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote } from "../src/model.ts";
import { dom, importHostModule } from "./helpers.mjs";

const { PendingReviewStatus } = await importHostModule("src/status.ts");

function setup(t) {
  const document = dom(), element = document.window.document.body.createDiv();
  let current = null, reads = 0;
  const calls = [], status = new PendingReviewStatus(element, () => { reads++; return current; }, (...args) => calls.push(args));
  status.load();
  t.after(() => { status.unload(); document.window.close(); });
  return { element, status, calls, document, set(value) { current = value; }, reads: () => reads };
}
function snapshot(source = "A {~~old~>new~~} sentence.", overrides = {}) {
  return { view: {}, file: { path: "Review.md" }, source, pending: parseNote(source).proposals.length, editable: true, busy: false, ...overrides };
}

test("status item is absent for no selected note or no proposals, with singular/plural counts", t => {
  const f = setup(t);
  f.status.refresh(); assert.equal(f.element.hidden, true);
  f.set(snapshot("No proposals.")); f.status.refresh(); assert.equal(f.element.hidden, true);
  f.set(snapshot()); f.status.refresh(); assert.equal(f.element.hidden, false);
  assert.equal(f.element.querySelector('[role="status"]').textContent, "1 pending change");
  f.set(snapshot("A {++one++} and {--two--} and {~~three~>four~~}.")); f.status.refresh();
  assert.equal(f.element.querySelector('[role="status"]').textContent, "3 pending changes");
});

test("status counts complete valid proposals, excluding literal and malformed markers", t => {
  const f = setup(t);
  const source = '---\ntitle: "{++literal++}"\n---\nA {~~many old words~>many new words~~} and {++valid++}.\n\n`{++code++}`\n\n{++outer {--nested--}++}\n';
  f.set(snapshot(source)); f.status.refresh();
  assert.equal(f.element.querySelector('[role="status"]').textContent, "2 pending changes");
});

test("status buttons resolve the displayed note and retain accessible bulk labels", t => {
  const f = setup(t), current = snapshot(); f.set(current); f.status.refresh();
  const buttons = [...f.element.querySelectorAll("button")];
  assert.deepEqual(buttons.map(b => b.getAttribute("aria-label")), ["Accept all changes in this note", "Reject all changes in this note"]);
  buttons[0].click(); buttons[1].click();
  assert.deepEqual(f.calls, [[current, "accept"], [current, "reject"]]);
});

test("Reading removes action elements and listeners rather than hiding them", t => {
  const f = setup(t), current = snapshot(); f.set(current); f.status.refresh();
  const oldButtons = [...f.element.querySelectorAll("button")];
  f.set({ ...current, editable: false }); f.status.refresh();
  assert.equal(f.element.hidden, false);
  assert.equal(f.element.querySelectorAll("button,.inline-diff-status-actions").length, 0);
  for (const button of oldButtons) button.click();
  assert.deepEqual(f.calls, []);
  f.set(current); f.status.refresh();
  assert.equal(f.element.querySelectorAll("button").length, 2);
});

test("resolution busy state disables both buttons without recreating focused controls", t => {
  const f = setup(t), current = snapshot(); f.set(current); f.status.refresh();
  const button = f.element.querySelector("button"); button.focus();
  f.set({ ...current, busy: true }); f.status.refresh();
  assert.equal(f.element.getAttribute("aria-busy"), "true");
  assert.ok([...f.element.querySelectorAll("button")].every(b => b.disabled));
  button.click(); assert.deepEqual(f.calls, []);
  f.set(current); f.status.refresh();
  assert.equal(f.element.querySelector("button"), button);
  assert.equal(button.ownerDocument.activeElement, button);
  assert.equal(button.disabled, false);
});

for (const change of ["view", "file", "source", "editable", "busy"]) test(`status refuses a stale ${change} before activation`, t => {
  const f = setup(t), current = snapshot(); f.set(current); f.status.refresh();
  f.set({ ...current, [change]: { view: {}, file: { path: "Other.md" }, source: "Agent update.", editable: false, busy: true }[change] });
  f.element.querySelector("button").click();
  assert.deepEqual(f.calls, []);
});

test("an empty or closed note removes previous mutation handlers", t => {
  const f = setup(t); f.set(snapshot()); f.status.refresh();
  const button = f.element.querySelector("button");
  f.set(null); f.status.refresh(); button.click();
  assert.equal(f.element.hidden, true); assert.equal(f.element.querySelectorAll("button").length, 0);
  assert.deepEqual(f.calls, []);
});

test("status updates coalesce and unload cancels scheduled reads and action handlers", async t => {
  const f = setup(t); f.set(snapshot());
  for (let i = 0; i < 20; i++) f.status.schedule();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.reads(), 1);
  const button = f.element.querySelector("button");
  f.status.schedule(); f.status.unload(); button.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.reads(), 1); assert.deepEqual(f.calls, []);
  assert.equal(f.element.children.length, 0);
});
