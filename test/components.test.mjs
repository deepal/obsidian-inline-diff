import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote, reviewGroups } from "../src/model.ts";
import { importHostModule, dom } from "./helpers.mjs";

const { Comparison } = await importHostModule("src/render.ts");
const { ReviewOverlay } = await importHostModule("src/overlay.ts");
const { normalizeSettings, defaults } = await importHostModule("src/settings.ts");

function setup(source, editable = false) {
  const document = dom(), note = parseNote(source), group = reviewGroups(note)[0];
  const view = editable ? { getMode: () => "source" } : null;
  const calls = [];
  const plugin = { isActive: true, overlay: () => ({ show: (...args) => calls.push(args), scheduleHide() {} }), scheduleOverlayHide() {} };
  const comparison = new Comparison({}, document.window.document, plugin, note, group, "Review.md", view, defaults);
  comparison.load(); document.window.document.body.append(comparison.element);
  return { dom: document, comparison, note, group, calls };
}

test("Reading comparison has no review controls, focus anchors, or overlay bindings", async () => {
  const f = setup("A {~~old~>new~~} sentence.");
  await f.comparison.ready;
  assert.equal(f.comparison.element.querySelectorAll("button,[tabindex]").length, 0);
  f.comparison.element.dispatchEvent(new f.dom.window.Event("pointerover", { bubbles: true }));
  assert.equal(f.calls.length, 0);
  assert.equal(f.comparison.element.querySelectorAll(".inline-diff-side").length, 2);
  f.comparison.unload(); f.dom.window.close();
});

test("independent anchors retain exact identity for multiple proposals", async () => {
  const f = setup("A {~~same~>one~~} and {~~same~>two~~}.", true);
  await f.comparison.ready;
  const anchors = [...f.comparison.element.querySelectorAll(".inline-diff-proposal-anchor")];
  assert.deepEqual(anchors.map(a => a.dataset.inlineDiffId), f.note.proposals.map(p => p.id));
  anchors[1].dispatchEvent(new f.dom.window.Event("pointerover", { bubbles: true }));
  assert.equal(f.calls[0][1].proposal.id, f.note.proposals[1].id);
  assert.equal(f.calls[0][1].source, f.note.source);
  f.comparison.unload(); f.dom.window.close();
});
test("malformed proposals remain visible beside a valid proposal in a shared container", async () => {
  const f = setup("A {++valid++} and {++outer {--nested--}++}.", true);
  await f.comparison.ready;
  assert.equal(f.note.proposals.length, 1);
  assert.match(f.comparison.element.querySelector(".inline-diff-diagnostic-banner").textContent, /Nested/);
  assert.ok(f.comparison.element.textContent.includes("{++outer {--nested--}++}"));
  assert.equal(f.comparison.element.querySelectorAll(".inline-diff-proposal-anchor").length, 1);
  f.comparison.unload(); f.dom.window.close();
});

test("late-generated native writing controls remain disabled", async () => {
  const f = setup("{~~<div>old</div>~><div>new</div>~~}");
  await f.comparison.ready;
  const body = f.comparison.element.querySelector(".inline-diff-content");
  const input = body.ownerDocument.createElement("input"); input.type = "checkbox";
  const base = body.ownerDocument.createElement("div"); base.className = "bases-view";
  body.append(input, base);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(input.disabled, true); assert.equal(base.inert, true);
  f.comparison.unload(); f.dom.window.close();
});

test("highlight boundaries preserve complete emoji grapheme clusters", async () => {
  const f = setup("A {~~👨🏾‍💻~>👩🏻‍🔬~~} example.", true);
  await f.comparison.ready;
  assert.deepEqual([...f.comparison.element.querySelectorAll(".inline-diff-before .inline-diff-changed")].map(el => el.textContent), ["👨🏾‍💻"]);
  assert.deepEqual([...f.comparison.element.querySelectorAll(".inline-diff-after .inline-diff-changed")].map(el => el.textContent), ["👩🏻‍🔬"]);
  f.comparison.unload(); f.dom.window.close();
});

test("unloaded comparisons ignore late rendering results", async () => {
  let finish;
  globalThis.__renderGate = new Promise(resolve => { finish = resolve; });
  const f = setup("A {++new++} sentence.");
  f.comparison.unload(); finish();
  await f.comparison.ready;
  delete globalThis.__renderGate;
  assert.equal(f.comparison.element.hasAttribute("data-inline-diff-ready"), false);
  assert.equal(f.comparison.element.querySelector("details"), null);
  f.dom.window.close();
});

test("overlay is outside note layout, clamps to the pane, resolves once and cleans up", () => {
  const document = dom(), doc = document.window.document, calls = [];
  const pane = doc.createElement("div"), anchor = doc.createElement("span"); pane.append(anchor); doc.body.append(pane);
  pane.getBoundingClientRect = () => ({ left: 100, right: 400, top: 50, bottom: 400 });
  anchor.getBoundingClientRect = () => ({ left: 110, right: 115, top: 70, bottom: 90 });
  const view = { getMode: () => "source", containerEl: pane };
  const overlay = new ReviewOverlay(doc, (...args) => calls.push(args)); overlay.load();
  Object.defineProperty(overlay.element, "offsetWidth", { value: 64 });
  Object.defineProperty(overlay.element, "offsetHeight", { value: 32 });
  const target = { view, source: "{++new++}", proposal: { id: "id" } };
  overlay.show(anchor, target);
  assert.equal(overlay.element.parentElement, doc.body); assert.equal(pane.children.length, 1);
  assert.equal(overlay.element.style.left, "104px"); assert.equal(overlay.element.style.top, "54px");
  assert.equal(overlay.element.querySelectorAll("button[aria-label]").length, 2);
  overlay.element.querySelector("[data-decision=accept]").click();
  assert.deepEqual(calls, [[target, "accept"]]); assert.equal(overlay.element.hidden, true);
  assert.equal(doc.querySelector(".inline-diff-toolbar"), null);
  overlay.unload(); assert.equal(doc.querySelector(".inline-diff-toolbar"), null); document.window.close();
});

test("overlay refuses a Reading-view target", () => {
  const document = dom(), doc = document.window.document;
  const overlay = new ReviewOverlay(doc, () => assert.fail("Reading cannot resolve")); overlay.load();
  const anchor = doc.createElement("span"); doc.body.append(anchor);
  overlay.show(anchor, { view: { getMode: () => "preview" } });
  assert.equal(overlay.element.hidden, true); overlay.unload(); document.window.close();
});

test("settings normalize untrusted data and preserve independent colours", () => {
  assert.deepEqual(normalizeSettings(null), defaults);
  assert.deepEqual(normalizeSettings({ additionText: 4, deletionText: "red;display:none", additionBackground: "url(https://bad)" }), defaults);
  assert.deepEqual(normalizeSettings({ additionText: "#123456", deletionText: "rgba(1,2,3,.5)" }), { ...defaults, additionText: "#123456", deletionText: "rgba(1,2,3,.5)" });
});
