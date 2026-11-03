import assert from "node:assert/strict";
import { test } from "node:test";
import { dom, importHostModule } from "./helpers.mjs";

const { ReadingCoordinator } = await importHostModule("src/reading.ts");

test("Reading retains source mappings for sections first processed offscreen", async t => {
  const document = dom(), doc = document.window.document;
  const root = doc.body.createDiv({ cls: "markdown-reading-view" }).createDiv({ cls: "markdown-preview-view" });
  const first = root.createDiv({ cls: "el-p" }), second = doc.createElement("div"), children = [];
  second.className = "el-p";
  const source = "{++first++}\n\n{++second++}\n";
  const plugin = { app: { workspace: { getLeavesOfType: () => [] } }, settings: {}, scheduleReviewBars() {} };
  const coordinator = new ReadingCoordinator(plugin); coordinator.load();
  t.after(() => { coordinator.unload(); for (const child of children) child.unload(); document.window.close(); });
  const context = line => ({ sourcePath: "Review.md", getSectionInfo: () => ({ text: source, lineStart: line, lineEnd: line }), addChild(child) { children.push(child); child.load(); } });
  coordinator.handle(first, context(0)); coordinator.handle(second, context(2));
  const waitFor = async predicate => {
    const deadline = Date.now() + 1000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate());
  };
  await waitFor(() => first.querySelector('[data-inline-diff-ready="true"]'));
  assert.equal(second.querySelector(".inline-diff-review"), null);
  assert.equal(coordinator.pendingSections.size, 1);
  root.append(second);
  await waitFor(() => second.querySelector('[data-inline-diff-ready="true"]'));
  assert.equal(coordinator.pendingSections.size, 0);
  assert.equal(root.querySelectorAll(".inline-diff-review").length, 2);
  assert.notEqual(first.querySelector("section").dataset.inlineDiffGroup, second.querySelector("section").dataset.inlineDiffGroup);
  first.remove(); root.append(first);
  await waitFor(() => root.querySelectorAll(".inline-diff-review").length === 2);
  coordinator.unload(); assert.equal(coordinator.pendingSections.size, 0);
});
