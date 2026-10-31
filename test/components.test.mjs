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
  const plugin = { isActive: true, overlay: () => ({ show: (...args) => calls.push(args), focus() {}, scheduleHide() {} }), scheduleOverlayHide() {} };
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
  assert.equal(f.calls[0][0], f.comparison.element);
  assert.equal(f.calls[0][1].proposal.id, f.note.proposals[1].id);
  assert.equal(f.calls[0][1].source, f.note.source);
  assert.equal(f.calls[0][2], anchors[1]);
  f.comparison.unload(); f.dom.window.close();
});
test("all word highlights in one proposal use the complete comparison as their toolbar anchor", async () => {
  const f = setup("{~~The service starts slowly and uses old settings.~>The service boots quickly and loads new settings.~~}", true);
  await f.comparison.ready;
  const highlights = [...f.comparison.element.querySelectorAll(".inline-diff-changed")];
  assert.ok(highlights.length >= 4);
  for (const highlight of highlights) {
    assert.equal(highlight.hasAttribute("data-inline-diff-id"), false);
    assert.equal(highlight.hasAttribute("tabindex"), false);
    highlight.dispatchEvent(new f.dom.window.Event("pointerover", { bubbles: true }));
    const [anchor, target, focusAnchor] = f.calls.at(-1);
    assert.equal(anchor, f.comparison.element);
    assert.equal(focusAnchor, f.comparison.element);
    assert.equal(target.proposal.id, f.note.proposals[0].id);
  }
  f.comparison.unload(); f.dom.window.close();
});
test("hovering shared-container words never selects an individual proposal", async () => {
  const f = setup("A {~~old~>new~~} word and {~~slow~>fast~~} response.", true);
  await f.comparison.ready;
  for (const highlight of f.comparison.element.querySelectorAll(".inline-diff-changed")) {
    highlight.dispatchEvent(new f.dom.window.Event("pointerover", { bubbles: true }));
  }
  assert.equal(f.calls.length, 0);
  f.comparison.unload(); f.dom.window.close();
});
test("ordinary comparisons have no title, visible side labels, source section, or single-change badge", async () => {
  for (const editable of [true, false]) {
    const f = setup("A {~~old~>new~~} sentence.", editable);
    await f.comparison.ready;
    const root = f.comparison.element;
    assert.equal(root.querySelector(".inline-diff-heading,.inline-diff-side-label,.inline-diff-source,.inline-diff-anchors"), null);
    assert.equal(root.querySelector(".inline-diff-before").getAttribute("aria-label"), "Before");
    assert.equal(root.querySelector(".inline-diff-after").getAttribute("aria-label"), "After");
    assert.equal(root.matches(".inline-diff-proposal-anchor"), editable);
    assert.equal(root.hasAttribute("title"), false);
    if (editable) {
      root.dispatchEvent(new f.dom.window.Event("focusin", { bubbles: true }));
      assert.equal(f.calls[0][1].proposal.id, f.note.proposals[0].id);
    }
    f.comparison.unload(); f.dom.window.close();
  }
});
test("invisible destination changes keep source evidence without restoring the heading", async () => {
  const f = setup('{~~<a href="Target.md">Same label</a>~><a href="Other.md">Same label</a>~~}', true);
  await f.comparison.ready;
  const details = f.comparison.element.querySelector(".inline-diff-source");
  assert.equal(details.open, true);
  assert.equal(details.querySelector("summary").textContent, "Hidden Markdown changes");
  assert.equal(details.querySelectorAll(".inline-diff-source-entry").length, 1);
  assert.equal(f.comparison.element.querySelector(".inline-diff-heading"), null);
  f.comparison.unload(); f.dom.window.close();
});
test("keyboard navigation within rendered links is not intercepted by the comparison anchor", async () => {
  const f = setup('{~~<a href="Target.md">Old label</a>~><a href="Other.md">New label</a>~~}', true);
  await f.comparison.ready;
  const link = f.comparison.element.querySelector(".inline-diff-after a");
  const event = new f.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  const review = new f.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  f.comparison.element.dispatchEvent(review);
  assert.equal(review.defaultPrevented, true);
  f.comparison.unload(); f.dom.window.close();
});
test("a shared container shows source evidence only for its invisible proposal", async () => {
  const f = setup('A {~~old~>new~~} and {~~<a href="Target.md">Same label</a>~><a href="Other.md">Same label</a>~~}.', true);
  await f.comparison.ready;
  const entries = [...f.comparison.element.querySelectorAll(".inline-diff-source-entry")];
  assert.deepEqual(entries.map(entry => entry.dataset.inlineDiffId), [f.note.proposals[1].id]);
  assert.equal(f.comparison.element.querySelectorAll(".inline-diff-anchors > .inline-diff-proposal-anchor").length, 2);
  f.comparison.unload(); f.dom.window.close();
});
test("malformed proposals remain visible beside a valid proposal in a shared container", async () => {
  const f = setup("A {++valid++} and {++outer {--nested--}++}.", true);
  await f.comparison.ready;
  assert.equal(f.note.proposals.length, 1);
  assert.match(f.comparison.element.querySelector(".inline-diff-diagnostic-banner").textContent, /Nested/);
  assert.ok(f.comparison.element.textContent.includes("{++outer {--nested--}++}"));
  assert.equal(f.comparison.element.matches(".inline-diff-proposal-anchor"), true);
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

test("a block-positioned toolbar restores keyboard focus to its numbered proposal selector", () => {
  const document = dom(), doc = document.window.document;
  const pane = doc.createElement("div"), block = doc.createElement("section"), selector = doc.createElement("span");
  selector.tabIndex = 0; block.append(selector); pane.append(block); doc.body.append(pane);
  pane.getBoundingClientRect = () => ({ left: 0, right: 600, top: 0, bottom: 500 });
  block.getBoundingClientRect = () => ({ left: 20, right: 550, top: 100, bottom: 400 });
  selector.getBoundingClientRect = () => ({ left: 500, right: 520, top: 130, bottom: 150 });
  const overlay = new ReviewOverlay(doc, () => assert.fail("Escape cannot resolve")); overlay.load();
  Object.defineProperty(overlay.element, "offsetWidth", { value: 64 });
  Object.defineProperty(overlay.element, "offsetHeight", { value: 32 });
  overlay.show(block, { view: { getMode: () => "source", containerEl: pane } }, selector);
  assert.equal(overlay.element.style.left, "486px");
  assert.equal(overlay.element.style.top, "72px");
  overlay.focus();
  doc.activeElement.dispatchEvent(new document.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(doc.activeElement, selector);
  assert.equal(doc.querySelector(".inline-diff-toolbar"), null);
  overlay.unload(); document.window.close();
});

test("settings normalize untrusted data and preserve independent colours", () => {
  assert.deepEqual(normalizeSettings(null), defaults);
  assert.deepEqual(normalizeSettings({ additionText: 4, deletionText: "red;display:none", additionBackground: "url(https://bad)" }), defaults);
  assert.deepEqual(normalizeSettings({ additionText: "#123456", deletionText: "rgba(1,2,3,.5)" }), { ...defaults, additionText: "#123456", deletionText: "rgba(1,2,3,.5)" });
});
