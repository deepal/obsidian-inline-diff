import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNote, reviewGroups } from "../src/model.ts";
import { dom, importHostModule } from "./helpers.mjs";

const { navigationIndex, ChangeNavigator } = await importHostModule("src/navigation.ts");
const source = "Intro.\n\nA {~~same~>same new~~} and {~~same~>same new~~}.\n\n{++last++}\n";
const { proposals } = parseNote(source);

for (const count of [0, 1]) for (const direction of [-1, 1]) test(`${count} proposals cannot navigate ${direction}`, () => {
  assert.equal(navigationIndex(proposals.slice(0, count), 0, direction, null), null);
});
test("first navigation uses the visible position, includes an intersecting proposal, and wraps", () => {
  assert.equal(navigationIndex(proposals, 0, 1, null), 0);
  assert.equal(navigationIndex(proposals, 0, -1, null), 2);
  assert.equal(navigationIndex(proposals, proposals[0].from + 2, 1, null), 0);
  assert.equal(navigationIndex(proposals, proposals[1].from, 1, null), 1);
  assert.equal(navigationIndex(proposals, proposals[1].from, -1, null), 0);
  assert.equal(navigationIndex(proposals, proposals[1].to, 1, null), 2);
  assert.equal(navigationIndex(proposals, source.length, 1, null), 0);
  assert.equal(navigationIndex(proposals, source.length, -1, null), 2);
});
for (const count of [2, 3, 50]) test(`${count} proposals advance individually in both directions and wrap`, () => {
  const { proposals } = parseNote(Array.from({ length: count }, () => "{~~same~>same new~~}").join(" "));
  let previous = null;
  for (let step = 0; step <= count * 2; step++) {
    previous = navigationIndex(proposals, 0, 1, previous);
    assert.equal(previous, step % count);
  }
  previous = 0;
  for (let step = 1; step <= count * 2; step++) {
    previous = navigationIndex(proposals, 0, -1, previous);
    assert.equal(previous, (count - step % count) % count);
  }
});
test("literal and malformed markers do not become navigation destinations", () => {
  const note = parseNote('---\ntitle: "{++literal++}"\n---\n`{++code++}`\n\n{++one++}\n\n{~~broken~~}\n\n{--two--}');
  assert.equal(note.proposals.length, 2);
  assert.equal(navigationIndex(note.proposals, 0, 1, null), 0);
  assert.equal(navigationIndex(note.proposals, 0, 1, 0), 1);
});

function reading(t, render = true) {
  const document = dom(), host = document.window.document.body.createDiv();
  const surface = host.createDiv({ cls: "markdown-reading-view" }).createDiv({ cls: "markdown-preview-view" });
  surface.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 });
  const text = "{++first++}\n\n{++second++}\n", calls = [];
  const groups = reviewGroups(parseNote(text));
  if (render) for (const [index, group] of groups.entries()) {
    const element = surface.createDiv({ cls: "inline-diff-review" });
    element.dataset.inlineDiffGroup = group.id; element.dataset.inlineDiffReady = "true";
    element.getBoundingClientRect = () => ({ top: index * 700 - surface.scrollTop, bottom: index * 700 - surface.scrollTop + 100, height: 100 });
  }
  let mode = "preview";
  const view = { contentEl: host, getMode: () => mode, currentMode: { getScroll: () => surface.scrollTop / 350 }, setEphemeralState(state) { calls.push(state); surface.scrollTop = state.line * 350; } };
  let current = { view, source: text, file: { path: "Review.md" }, pending: 2, editable: false, busy: false };
  const navigator = new ChangeNavigator(() => current, () => null, () => {});
  navigator.load(); navigator.refresh(current);
  t.after(() => { navigator.unload(); document.window.close(); });
  return { navigator, calls, surface, document, update(change) { current = { ...current, ...change }; navigator.refresh(current); }, mode(value) { mode = value; navigator.refresh(current); } };
}
async function finished(navigator) {
  const deadline = Date.now() + 4000;
  while (navigator.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(navigator.busy, false);
}

test("Reading navigation settles by source identity, ignores its own scrolling and resets on manual scrolling", async t => {
  const f = reading(t);
  f.navigator.go(1); await finished(f.navigator); assert.equal(f.navigator.message, "Change 1 of 2");
  f.surface.dispatchEvent(new f.document.window.Event("scroll"));
  assert.equal(f.navigator.message, "Change 1 of 2");
  f.navigator.go(1); await finished(f.navigator); assert.equal(f.navigator.message, "Change 2 of 2");
  assert.ok(f.surface.querySelector(".inline-diff-navigation-target"));
  f.surface.scrollTop = 0; f.surface.dispatchEvent(new f.document.window.Event("scroll"));
  assert.equal(f.navigator.message, "");
  assert.equal(f.surface.querySelector(".inline-diff-navigation-target"), null);
  f.navigator.go(1); await finished(f.navigator); assert.equal(f.navigator.message, "Change 1 of 2");
});

test("Reading navigation matches normalized render offsets when serialized source preserves BOM and CRLF", async t => {
  const f = reading(t);
  f.update({ source: "\uFEFF{++first++}\r\n\r\n{++second++}\r\n" });
  f.navigator.go(1); await finished(f.navigator); assert.equal(f.navigator.message, "Change 1 of 2");
  f.navigator.go(1); await finished(f.navigator); assert.equal(f.navigator.message, "Change 2 of 2");
});

for (const reason of ["source", "file", "mode", "wheel", "unload"]) test(`pending navigation cancels on ${reason}`, async t => {
  const f = reading(t);
  f.navigator.go(1); assert.equal(f.navigator.busy, true);
  if (reason === "source") f.update({ source: "Changed source.", pending: 0 });
  if (reason === "file") f.update({ file: { path: "Other.md" } });
  if (reason === "mode") f.mode("source");
  if (reason === "wheel") f.surface.dispatchEvent(new f.document.window.WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
  if (reason === "unload") f.navigator.unload();
  await finished(f.navigator); await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(f.calls, []); assert.equal(f.navigator.message, "");
  assert.equal(f.surface.querySelector(".inline-diff-navigation-target"), null);
});

test("render failure has a bounded wait and re-enables navigation", async t => {
  const f = reading(t, false);
  globalThis.__notices = []; t.after(() => { delete globalThis.__notices; });
  f.navigator.go(1); await finished(f.navigator);
  assert.equal(f.navigator.message, "");
  assert.equal(globalThis.__notices.length, 1);
});
