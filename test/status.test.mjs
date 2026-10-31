import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote } from "../src/model.ts";
import { dom, importHostModule } from "./helpers.mjs";

const { ReviewBar, ReviewBarCoordinator } = await importHostModule("src/status.ts");

function setup(t) {
  const document = dom(), host = document.window.document.body.createDiv({ cls: "view-content" });
  let current = null, reads = 0;
  const calls = [], status = new ReviewBar(host, () => { reads++; return current; }, (...args) => calls.push(args));
  status.load();
  t.after(() => { status.unload(); document.window.close(); });
  return { element: status.element, host, status, calls, document, set(value) { current = value; }, reads: () => reads };
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
  assert.equal(f.element.querySelectorAll("button,.inline-diff-review-bar-actions").length, 0);
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

test("coordinator coalesces updates and cancels work and handlers on unload", async t => {
  const document = dom(), host = document.window.document.body.createDiv({ cls: "view-content" });
  const view = { contentEl: host, file: { path: "Review.md" } };
  let reads = 0;
  const calls = [], current = snapshot(undefined, { view, file: view.file });
  const coordinator = new ReviewBarCoordinator(document.window, () => [view], () => { reads++; return current; }, (...args) => calls.push(args), () => {});
  coordinator.load(); t.after(() => { coordinator.unload(); document.window.close(); });
  for (let i = 0; i < 20; i++) coordinator.schedule();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reads, 1);
  const button = host.querySelector("button");
  coordinator.schedule(); coordinator.unload(); button.click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(reads, 1); assert.deepEqual(calls, []);
  assert.equal(host.querySelector(".inline-diff-review-bar"), null);
  assert.equal(host.classList.contains("inline-diff-has-review-bar"), false);
});

test("review bar precedes native content and owns only its layout class", t => {
  const f = setup(t), native = f.host.createDiv({ cls: "markdown-source-view" });
  f.set(snapshot()); f.status.refresh();
  assert.equal(f.host.firstElementChild, f.element);
  assert.equal(native.parentElement, f.host);
  assert.ok(f.host.classList.contains("inline-diff-has-review-bar"));
  f.set(snapshot("No proposals.")); f.status.refresh();
  assert.equal(f.host.classList.contains("inline-diff-has-review-bar"), false);
  f.status.unload(); assert.equal(native.parentElement, f.host);
});

test("coordinator binds separate note panes and removes closed views without duplicate bars", t => {
  const document = dom(), doc = document.window.document;
  const views = ["One.md", "Two.md"].map(path => ({ contentEl: doc.body.createDiv({ cls: "view-content" }), file: { path } }));
  const calls = [], coordinator = new ReviewBarCoordinator(document.window, () => views, view => snapshot(undefined, { view, file: view.file }), (...args) => calls.push(args), () => {});
  coordinator.load(); t.after(() => { coordinator.unload(); document.window.close(); });
  coordinator.refresh(); coordinator.refresh();
  assert.equal(doc.querySelectorAll(".inline-diff-review-bar").length, 2);
  views[1].contentEl.querySelector('[data-decision="accept"]').click();
  assert.equal(calls[0][0].view, views[1]);
  const closed = views.pop(), button = closed.contentEl.querySelector("button");
  coordinator.refresh(); button.click();
  assert.equal(calls.length, 1);
  assert.equal(closed.contentEl.querySelector(".inline-diff-review-bar"), null);
});

test("coordinator recreates a bar in the owning document after pane migration", t => {
  const main = dom(), popout = dom();
  const oldHost = main.window.document.body.createDiv({ cls: "view-content" });
  const view = { contentEl: oldHost, file: { path: "Review.md" } };
  const coordinator = new ReviewBarCoordinator(main.window, () => [view], () => snapshot(undefined, { view, file: view.file }), () => {}, () => {});
  coordinator.load(); t.after(() => { coordinator.unload(); main.window.close(); popout.window.close(); });
  coordinator.refresh();
  view.contentEl = popout.window.document.body.createDiv({ cls: "view-content" });
  coordinator.refresh();
  assert.equal(oldHost.querySelector(".inline-diff-review-bar"), null);
  assert.equal(view.contentEl.querySelectorAll(".inline-diff-review-bar").length, 1);
  assert.equal(view.contentEl.querySelector("button").ownerDocument, popout.window.document);
});
