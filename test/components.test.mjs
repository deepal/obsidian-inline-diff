import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote, reviewGroups } from "../src/model.ts";
import { importHostModule, dom } from "./helpers.mjs";

const { Comparison } = await importHostModule("src/render.ts");
const { ReviewOverlay } = await importHostModule("src/overlay.ts");
const { normalizeSettings, defaults } = await importHostModule("src/settings.ts");

function setup(source, editable = false, presentation = { mode: editable ? "live" : "reading" }) {
  const document = dom(), note = parseNote(source), group = reviewGroups(note)[0];
  const view = editable ? { getMode: () => "source" } : null;
  const calls = [];
  const plugin = { isActive: true, overlay: () => ({ show: (...args) => calls.push(args), focus() {}, scheduleHide() {} }), scheduleOverlayHide() {} };
  const comparison = new Comparison({}, document.window.document, plugin, note, group, "Review.md", view, defaults, presentation);
  comparison.load(); document.window.document.body.append(comparison.element);
  return { dom: document, comparison, note, group, calls };
}

test("Reading renders one document without mutation controls or focus anchors", async () => {
  const f = setup("A {~~old~>new~~} sentence."); await f.comparison.ready;
  assert.equal(f.comparison.element.querySelectorAll("button,[tabindex]").length, 0);
  assert.equal(f.comparison.element.querySelectorAll(".inline-diff-content").length, 1);
  assert.equal(f.comparison.element.querySelector(".inline-diff-anchors,details"), null);
  assert.equal(f.comparison.element.textContent, "A oldnew sentence.");
  f.comparison.unload(); f.dom.window.close();
});

test("identical words retain independently source-mapped anchors and decisions", async () => {
  const f = setup("A {~~same~>one~~} and {~~same~>two~~}.", true); await f.comparison.ready;
  const anchors = [...f.comparison.element.querySelectorAll(".inline-diff-hunk-anchor")];
  assert.deepEqual(anchors.map(a => a.dataset.inlineDiffId), f.note.proposals.map(p => p.id));
  anchors[1].dispatchEvent(new f.dom.window.Event("pointerover", { bubbles: true }));
  assert.equal(f.calls[0][0], anchors[1]); assert.equal(f.calls[0][1].proposal.id, f.note.proposals[1].id);
  assert.equal(f.calls[0][1].source, f.note.source);
  f.comparison.unload(); f.dom.window.close();
});

test("every hunk in a multi-passage proposal resolves the complete proposal", async () => {
  const f = setup("{~~The service starts slowly and uses old settings.~>The service boots quickly and loads new settings.~~}", true); await f.comparison.ready;
  const highlights = [...f.comparison.element.querySelectorAll(".inline-diff-changed")]; assert.ok(highlights.length >= 4);
  for (const highlight of highlights) {
    assert.equal(highlight.closest(".inline-diff-proposal").dataset.inlineDiffId, f.note.proposals[0].id);
    highlight.dispatchEvent(new f.dom.window.Event("pointerover", { bubbles: true }));
    assert.equal(f.calls.at(-1)[0], highlight.closest(".inline-diff-proposal")); assert.equal(f.calls.at(-1)[1].proposal.id, f.note.proposals[0].id);
  }
  assert.equal(f.comparison.element.querySelectorAll("[tabindex]").length, 1);
  f.comparison.unload(); f.dom.window.close();
});

test("invisible edits have visible local evidence with no collapsed details", async () => {
  const f = setup("A {~~<!-- old -->~><!-- new -->~~} sentence.", true); await f.comparison.ready;
  assert.equal(f.comparison.element.querySelectorAll(".inline-diff-evidence").length, 2);
  assert.match(f.comparison.element.textContent, /old.*new/);
  assert.equal(f.comparison.element.querySelector("details,.inline-diff-anchors"), null);
  f.comparison.unload(); f.dom.window.close();
});

test("link keyboard activation is preserved while hunk Enter reaches review controls", async () => {
  const f = setup('{~~<a href="Target.md">Old label</a>~><a href="Other.md">New label</a>~~}', true); await f.comparison.ready;
  const link = f.comparison.element.querySelector('[data-inline-diff-side="after"] a');
  const event = new f.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }); link.dispatchEvent(event);
  // A native link remains a link. Review activation uses a dedicated hunk span.
  assert.equal(event.defaultPrevented, false);
  f.comparison.unload(); f.dom.window.close();
});

test("malformed markers remain visible beside valid changes", async () => {
  const f = setup("A {++valid++} and {++outer {--nested--}++}.", true); await f.comparison.ready;
  assert.match(f.comparison.element.querySelector(".inline-diff-diagnostic-banner").textContent, /Nested/);
  assert.ok(f.comparison.element.textContent.includes("{++outer {--nested--}++}"));
  f.comparison.unload(); f.dom.window.close();
});

test("late generated writing controls remain disabled", async () => {
  const f = setup("{~~<div>old</div>~><div>new</div>~~}"); await f.comparison.ready;
  const body = f.comparison.element.querySelector(".inline-diff-content"), input = body.ownerDocument.createElement("input"), base = body.ownerDocument.createElement("div");
  input.type = "checkbox"; base.className = "bases-view"; body.append(input, base); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(input.disabled, true); assert.equal(base.inert, true); f.comparison.unload(); f.dom.window.close();
});

test("highlight boundaries preserve emoji grapheme clusters", async () => {
  const f = setup("A {~~👨🏾‍💻~>👩🏻‍🔬~~} example.", true); await f.comparison.ready;
  for (const [side, text] of [["before", "👨🏾‍💻"], ["after", "👩🏻‍🔬"]]) assert.deepEqual([...f.comparison.element.querySelectorAll(`[data-inline-diff-side=${side}]`)].map(el => el.textContent), [text]);
  f.comparison.unload(); f.dom.window.close();
});

test("math and SVG structural fragments preserve the native glyph tree", async () => {
  const f = setup('{~~<div class="math"><mjx-container><mjx-c>x</mjx-c></mjx-container></div><svg><text>old</text></svg>~><div class="math"><mjx-container><mjx-c>y</mjx-c></mjx-container></div><svg><text>new</text></svg>~~}'); await f.comparison.ready;
  for (const side of ["before", "after"]) {
    assert.ok(f.comparison.element.querySelector(`[data-inline-diff-side=${side}] .math > mjx-container > mjx-c`));
    assert.ok(f.comparison.element.querySelector(`[data-inline-diff-side=${side}] svg > text`));
  }
  assert.equal(f.comparison.element.querySelector(".math .inline-diff-text,svg .inline-diff-text"), null); f.comparison.unload(); f.dom.window.close();
});

test("asynchronous generated replacements retain their exact proposal anchor", async () => {
  const f = setup('{++<pre>generated placeholder</pre>++}', true); await f.comparison.ready;
  const generated = f.comparison.element.querySelector('pre'), replacement = generated.ownerDocument.createElement('div');
  replacement.className='mermaid'; replacement.textContent='Rendered diagram'; generated.replaceWith(replacement);
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(replacement.closest('.inline-diff-proposal').dataset.inlineDiffId,f.note.proposals[0].id);
  assert.equal(replacement.closest('[data-inline-diff-side]').dataset.inlineDiffSide,'after'); assert.ok(replacement.closest('.inline-diff-hunk-anchor'));
  replacement.dispatchEvent(new f.dom.window.Event('pointerover',{bubbles:true})); assert.equal(f.calls.at(-1)[1].proposal.id,f.note.proposals[0].id);
  f.comparison.unload();f.dom.window.close();
});

test("untrusted rendered attributes cannot impersonate a review hunk", async () => {
  const f=setup('A {~~old~>new~~} sentence.',true);await f.comparison.ready;
  const fake=f.comparison.element.ownerDocument.createElement('span');fake.className='inline-diff-unit';fake.dataset.inlineDiffId=f.note.proposals[0].id;fake.textContent='unrelated';f.comparison.element.append(fake);
  fake.dispatchEvent(new f.dom.window.Event('pointerover',{bubbles:true}));assert.equal(f.calls.length,0);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(fake.hasAttribute('tabindex'),false);
  assert.equal(f.comparison.element.querySelectorAll('.inline-diff-hunk-anchor').length,1);
  f.comparison.unload();f.dom.window.close();
});

test("unloaded comparisons ignore deferred rendering", async () => {
  let finish; globalThis.__renderGate = new Promise(resolve => { finish = resolve; });
  const f = setup("A {++new++} sentence."); f.comparison.unload(); finish(); await f.comparison.ready; delete globalThis.__renderGate;
  assert.equal(f.comparison.element.hasAttribute("data-inline-diff-ready"), false); f.dom.window.close();
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

test("a local toolbar restores keyboard focus to its hunk", () => {
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
  assert.equal(normalizeSettings({ additionText: "#123456" }).showExplorerBadges, true);
  assert.equal(normalizeSettings({ showExplorerBadges: false }).showExplorerBadges, false);
  assert.equal(normalizeSettings({ showExplorerBadges: "false" }).showExplorerBadges, true);
  assert.deepEqual(normalizeSettings({ additionText: 4, deletionText: "red;display:none", additionBackground: "url(https://bad)" }), defaults);
  assert.deepEqual(normalizeSettings({ additionText: "#123456", deletionText: "rgba(1,2,3,.5)" }), { ...defaults, additionText: "#123456", deletionText: "rgba(1,2,3,.5)" });
});


test("presentation context stays independent of mutation permission", async()=>{
 const f=setup('A {~~old~>new~~} sentence.',false,{mode:'live'});await f.comparison.ready;
 assert.equal(f.comparison.element.querySelectorAll('.inline-diff-side-content.markdown-rendered').length,0);
 assert.equal(f.comparison.element.querySelectorAll('[tabindex],button').length,0);
 f.comparison.unload();f.dom.window.close();
});
test("Reading comparisons inherit the existing rendered boundary", async()=>{
 const f=setup('A {~~old~>new~~} sentence.',false,{mode:'reading'});await f.comparison.ready;
 assert.equal(f.comparison.element.querySelectorAll('.markdown-rendered').length,0);
 f.comparison.unload();f.dom.window.close();
});
test("comparison resize requests coalesce and cancel on disposal",async()=>{
 let callback,disconnected=false,calls=0;const f=setup('A {~~old~>new~~} sentence.',false,{mode:'live',requestMeasure:()=>calls++});
 f.dom.window.ResizeObserver=class{constructor(cb){callback=cb}observe(){}disconnect(){disconnected=true}};
 await f.comparison.ready;callback([{contentRect:{width:300,height:100}}]);callback([{contentRect:{width:300,height:120}}]);
 await new Promise(r=>setTimeout(r,40));assert.equal(calls,1);
 callback([{contentRect:{width:300,height:120}}]);await new Promise(r=>setTimeout(r,25));assert.equal(calls,1);
 callback([{contentRect:{width:400,height:120}}]);f.comparison.unload();await new Promise(r=>setTimeout(r,25));assert.equal(calls,1);assert.equal(disconnected,true);f.dom.window.close();
});
