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

for (const kind of ["addition", "deletion", "replacement"]) test(`${kind} preserves block and list adjacency and exact rendered text`, async () => {
  const html = '<h2>New heading</h2>\n<p>First <strong>paragraph</strong>.</p>\n<h3>Details</h3>\n<ul>\n<li>One</li>\n<li>Two<ul>\n<li>Nested</li>\n<li>Last</li>\n</ul></li>\n</ul>\n<p>Final words.</p>';
  const marker = kind === "addition" ? `{++${html}++}` : kind === "deletion" ? `{--${html}--}` : `{~~<p>Old content.</p>~>${html}~~}`;
  const f = setup(marker);
  await f.comparison.ready;
  const body = f.comparison.element.querySelector(`.inline-diff-${kind === "deletion" ? "before" : "after"} .inline-diff-content`);
  const native = body.ownerDocument.createElement("div"); native.innerHTML = html;
  assert.equal(body.textContent, native.textContent);
  assert.deepEqual([...body.children].map(el => el.tagName), ["H2", "P", "H3", "UL", "P"]);
  assert.ok(body.querySelector("p + h3")); assert.equal(body.querySelectorAll("ul > li + li").length, 2);
  assert.ok([...body.querySelectorAll(".inline-diff-changed")].every(el => !/^[\t\n\f\r ]+$/.test(el.textContent)));
  assert.match(body.querySelector("p:last-child .inline-diff-changed").textContent, /Final/);
  f.comparison.unload(); f.dom.window.close();
});

for (const separator of ["", "\n", "\n\n"]) test(`separator-only changes retain source evidence (${JSON.stringify(separator)})`, async () => {
  const f = setup(`{~~<p>First</p>\n<p>Last</p>~><p>First</p>${separator}<p>Last</p>~~}`);
  await f.comparison.ready;
  assert.equal(f.comparison.element.querySelectorAll(".inline-diff-content .inline-diff-changed").length, 0);
  assert.equal(f.comparison.element.querySelectorAll(".inline-diff-source-entry").length, 1);
  f.comparison.unload(); f.dom.window.close();
});

test("highlight offsets include unwrapped separators before a later inline replacement", async () => {
  const f = setup('{~~<p>Leading.</p>\n<h3>Section</h3>\n<p>Tail old value.</p>~><p>Leading.</p>\n<h3>Section</h3>\n<p>Tail new value.</p>~~}');
  await f.comparison.ready;
  for (const [side, word] of [["before", "old"], ["after", "new"]]) {
    const body = f.comparison.element.querySelector(`.inline-diff-${side} .inline-diff-content`);
    assert.deepEqual([...body.children].map(el => el.tagName), ["P", "H3", "P"]);
    assert.deepEqual([...body.querySelectorAll(".inline-diff-changed")].map(el => el.textContent), [word]);
    assert.equal(body.lastElementChild.textContent, `Tail ${word} value.`);
  }
  f.comparison.unload(); f.dom.window.close();
});

test("highlighting ignores inherited editor whitespace before the stylesheet is ready and restores its measurement context", async () => {
  let finish;
  globalThis.__renderGate = new Promise(resolve => { finish = resolve; });
  const f = setup('{++<h2>Heading</h2>\n<p>Paragraph.</p>\n<h3>Next</h3>\n<ul>\n<li>One</li>\n<li>Two</li>\n</ul>++}');
  const bodies = [...f.comparison.element.querySelectorAll(".inline-diff-content")];
  for (const body of bodies) body.setAttribute("style", "white-space: break-spaces !important");
  const originalStyles = bodies.map(body => body.getAttribute("style"));
  try {
    finish(); await f.comparison.ready;
    const body = bodies[1];
    assert.deepEqual([...body.children].map(el => el.tagName), ["H2", "P", "H3", "UL"]);
    assert.ok(body.querySelector("p + h3"));
    assert.equal(body.querySelectorAll("ul > li + li").length, 1);
    assert.ok([...body.querySelectorAll(".inline-diff-changed")].every(el => !/^[\t\n\f\r ]+$/.test(el.textContent)));
    for (const [index, body] of bodies.entries()) {
      assert.equal(body.style.getPropertyValue("white-space"), "break-spaces");
      assert.equal(body.getAttribute("style"), originalStyles[index]);
    }
  } finally { delete globalThis.__renderGate; f.comparison.unload(); f.dom.window.close(); }
});

test("preformatted whitespace, inline spaces, and NBSP remain highlightable", async () => {
  const html = '<pre> \n\n</pre>\n<div style="white-space: pre-wrap">\n\n</div>\n<p><b>A</b> <i>B</i>\u00a0<strong>C</strong></p>\n<p>Tail.</p>';
  const f = setup(`{++${html}++}`); await f.comparison.ready;
  const body = f.comparison.element.querySelector(".inline-diff-after .inline-diff-content");
  assert.equal(body.querySelector("pre .inline-diff-changed").textContent, " \n\n");
  assert.equal(body.querySelector("div[style] .inline-diff-changed").textContent, "\n\n");
  assert.ok([...body.querySelectorAll("p > .inline-diff-changed")].some(el => el.textContent === " "));
  assert.ok([...body.querySelectorAll("p > .inline-diff-changed")].some(el => el.textContent === "\u00a0"));
  assert.equal(body.querySelector("p:last-child").textContent, "Tail.");
  f.comparison.unload(); f.dom.window.close();
});

test("math and SVG highlights preserve the native glyph tree", async () => {
  const f = setup('{~~<div class="math"><mjx-container><mjx-c>x</mjx-c></mjx-container></div><svg><text>old</text></svg>~><div class="math"><mjx-container><mjx-c>y</mjx-c></mjx-container></div><svg><text>new</text></svg>~~}');
  await f.comparison.ready;
  for (const side of ["before", "after"]) {
    const root = f.comparison.element.querySelector(`.inline-diff-${side} .inline-diff-content`), colour = side === "before" ? "inline-diff-deletion" : "inline-diff-addition";
    assert.ok(root.querySelector(`.math.${colour} > mjx-container > mjx-c`));
    assert.ok(root.querySelector(`svg.${colour} > text`));
    assert.equal(root.querySelector(".math .inline-diff-changed,svg .inline-diff-changed"), null);
  }
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

test("a clamped toolbar leaves shared proposal selectors reachable", () => {
  const document = dom(), doc = document.window.document;
  const pane = doc.createElement("div"), block = doc.createElement("section"), selectors = doc.createElement("div");
  selectors.className = "inline-diff-anchors"; block.append(selectors); pane.append(block); doc.body.append(pane);
  pane.getBoundingClientRect = () => ({ left: 100, right: 500, top: 120, bottom: 600 });
  block.getBoundingClientRect = () => ({ left: 120, right: 480, top: 116, bottom: 400 });
  selectors.getBoundingClientRect = () => ({ left: 430, right: 476, top: 120, bottom: 142 });
  const overlay = new ReviewOverlay(doc, () => assert.fail("Positioning cannot resolve")); overlay.load();
  Object.defineProperty(overlay.element, "offsetWidth", { value: 64 });
  Object.defineProperty(overlay.element, "offsetHeight", { value: 32 });
  overlay.show(block, { view: { getMode: () => "source", containerEl: pane } });
  assert.equal(overlay.element.style.left, "416px");
  assert.equal(overlay.element.style.top, "146px");
  pane.getBoundingClientRect = () => ({ left: 100, right: 500, top: 120, bottom: 175 });
  overlay.show(block, { view: { getMode: () => "source", containerEl: pane } });
  assert.equal(overlay.element.style.left, "362px");
  assert.equal(overlay.element.style.top, "124px");
  overlay.unload(); document.window.close();
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
