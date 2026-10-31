import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { connectSession, installOracle, setFixture } from "./qa-client.mjs";
import { literalFixtures, boundaryFixtures } from "../test/fixtures/markdown.mjs";

const session = await connectSession(), { page } = session;
const passed = [], measurements = {}, errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error" && /inline.diff|plugin:inline-diff/i.test(message.text())) errors.push(message.text()); });
const source = "Intro.\n\n| Item | Value |\n| --- | --- |\n| A | {~~old~>new~~} |\n| B | {~~old~>second~~} |\n\n> [!note] Title\n> A {++new++} callout.\n\nTail.\n";
const matches = section => !process.env.QA_SECTION || new RegExp(process.env.QA_SECTION).test(section);
async function check(name, action) { await action(); passed.push(name); console.log(`PASS ${name}`); }
async function ready(mode, count = 2) {
  await page.waitForFunction(({ mode, count }) => {
    const root = app.workspace.activeLeaf.view.contentEl;
    if (mode === "source") return !!root.querySelector(".inline-diff-source-mark");
    if (root.querySelectorAll(`${mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view"} .inline-diff-review[data-inline-diff-ready=true]`).length !== count) return false;
    return mode !== "reading" || [...app.plugins.plugins["inline-diff"].reading.states.values()].some(state => root.contains(state.root) && state.renderedSource === app.workspace.activeLeaf.view.getViewData().replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") && state.comparisons.every(comparison => comparison.element.isConnected));
  }, { mode, count });
}
async function contents() { return page.evaluate(() => app.workspace.activeLeaf.view.getViewData()); }
async function bounds(mode) {
  return page.evaluate(mode => {
    const root = app.workspace.activeLeaf.view.contentEl.querySelector(mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view");
    const selectors = mode === "source" ? ".cm-line" : ".inline-diff-review,p,table,tr,td,th";
    return { rects: [...root.querySelectorAll(selectors)].map(el => {
      const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    }), scroll: [root.scrollWidth, root.scrollHeight] };
  }, mode);
}
async function proseGeometry(mode, contentWidth) {
  return page.evaluate(async ({ mode, contentWidth }) => {
    await document.fonts.ready;
    const measure = () => {
      const root = app.workspace.activeLeaf.view.contentEl.querySelector(mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view");
      const rect = element => { const r = element.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
      const paragraphs = [...root.querySelectorAll(mode === "reading" ? "p" : ".cm-line")].filter(element => !element.closest(".inline-diff-review"));
      const above = paragraphs.find(element => element.textContent === "Above paragraph."), below = paragraphs.find(element => element.textContent === "Below paragraph.");
      const comparison = root.querySelector(".inline-diff-review");
      const alternatives = comparison ? [...comparison.querySelectorAll(".inline-diff-content > p")] : [paragraphs.find(element => element.textContent.startsWith("The service"))];
      if (!comparison && contentWidth !== undefined) alternatives[0].style.width = `${contentWidth}px`;
      const content = alternatives.map(element => {
        const box = element.getBoundingClientRect(), lines = [], walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let text;
        while ((text = walker.nextNode())) {
          const range = document.createRange(); range.selectNodeContents(text);
          for (const r of range.getClientRects()) {
            if (!r.width) continue;
            const y = r.y - box.y, line = lines.find(line => Math.abs(line[1] - y) <= .5);
            if (line) { const right = Math.max(line[0] + line[2], r.right - box.x); line[0] = Math.min(line[0], r.x - box.x); line[2] = right - line[0]; }
            else lines.push([r.x - box.x, y, r.width, r.height]);
          }
        }
        return { rect: rect(element), lines };
      });
      const borders = element => { const s = getComputedStyle(element); return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(parseFloat); };
      const style = comparison && getComputedStyle(comparison);
      return { above: rect(above), below: rect(below), block: rect(comparison ?? alternatives[0]), content, outer: style && { margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft].map(parseFloat), border: borders(comparison), shadow: style.boxShadow }, sideBorders: comparison && [...comparison.querySelectorAll(":scope > .inline-diff-side")].map(borders) };
    };
    let previous = "", stable = 0;
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const measured = measure(), serialized = JSON.stringify(measured);
      stable = serialized === previous && document.fonts.status === "loaded" ? stable + 1 : 0;
      if (stable >= 12) return measured;
      previous = serialized;
    }
    throw Error("Prose geometry did not settle.");
  }, { mode, contentWidth });
}
function equalBounds(before, after) {
  assert.equal(before.rects.length, after.rects.length);
  for (const [index, rect] of before.rects.entries()) for (let coordinate = 0; coordinate < 4; coordinate++) assert.ok(Math.abs(rect[coordinate] - after.rects[index][coordinate]) <= .5, `hover moved rectangle ${index}: ${JSON.stringify(rect)} -> ${JSON.stringify(after.rects[index])}`);
  assert.deepEqual(before.scroll, after.scroll);
}
async function hoverFirst(mode) {
  const target = page.locator(mode === "source" ? ".cm-content .inline-diff-source-mark" : ".markdown-source-view .inline-diff-proposal-anchor").first();
  await page.mouse.move(5, 5);
  await page.waitForFunction(() => !document.querySelector(".inline-diff-toolbar"));
  const block = mode !== "source" && await target.evaluate(element => element.classList.contains("inline-diff-review"));
  if (mode !== "source" && !block) await page.locator(".markdown-source-view .inline-diff-review").first().hover({ position: { x: 6, y: 8 } });
  // Use the block padding: its centre can land under a word's floating toolbar.
  await target.hover(block ? { position: { x: 6, y: 8 } } : {}); await page.locator(".inline-diff-toolbar:visible").waitFor(); return target;
}
async function prepareHover(mode) {
  const target = page.locator(mode === "source" ? ".cm-content .inline-diff-source-mark" : ".markdown-source-view .inline-diff-proposal-anchor").first();
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.evaluate(async mode => {
    await document.fonts.ready;
    let previous = "", stable = 0;
    const deadline = performance.now() + 10000;
    while (performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const root = app.workspace.activeLeaf.view.contentEl.querySelector(mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view");
      const selector = mode === "source" ? ".cm-line" : ".inline-diff-review,p,table,tr,td,th";
      const current = JSON.stringify([...root.querySelectorAll(selector)].map(el => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
      const animating = root.getAnimations({ subtree: true }).some(animation => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity);
      stable = current === previous && document.fonts.status === "loaded" && !animating ? stable + 1 : 0;
      if (stable >= 12) return;
      previous = current;
    }
    throw Error("Native pane geometry did not settle before hover measurement.");
  }, mode);
}
async function execute(command) {
  return page.evaluate(async command => {
    const id = `inline-diff:${command}`;
    const runnable = app.commands.commands[id].checkCallback(true);
    const dispatched = app.commands.executeCommandById(id);
    await app.plugins.plugins["inline-diff"].lastResolution;
    return runnable && dispatched;
  }, command);
}

try {
  await installOracle(session);
  assert.equal(await page.evaluate(() => inlineDiffQa.version), "1.14.5");
  measurements.runtime = await page.evaluate(() => ({ obsidian: inlineDiffQa.version, electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node }));
  measurements.frontmatter = await page.evaluate(() => ({ unclosed: inlineDiffQa.frontmatterInfo("---\nBody.\n").exists, closed: inlineDiffQa.frontmatterInfo("---\ntitle: Test\n---\nBody.\n").exists }));
  if (matches("refresh")) {
    const original = "Intro.\n\nFood, water and livelihoods are connected.\n\nTail.\n";
    const proposed = "Intro.\n\n{~~Food, water and livelihoods are connected.~>Food, water and livelihoods depend on one another.~~}\n\nTail.\n";
    for (const position of ["inside", "outside"]) for (const focus of ["editor", "elsewhere"]) await check(`external Live Preview refresh with ${position} caret / ${focus} focus`, async () => {
      await setFixture(page, original, "live");
      await page.evaluate(({ position, focus }) => {
        const view = app.workspace.activeLeaf.view;
        view.editor.focus(); view.editor.setCursor(position === "inside" ? 2 : 4, position === "inside" ? 8 : 0);
        if (focus === "elsewhere") { const input = document.createElement("input"); input.id = "qa-focus"; document.body.append(input); input.focus(); }
      }, { position, focus });
      try {
        await fs.writeFile(path.join(session.vault, "Review.md"), proposed);
        await page.waitForFunction(proposed => app.workspace.activeLeaf.view.editor.getValue() === proposed, proposed);
        await ready("live", 1);
        const state = await page.evaluate(() => ({ cursor: app.workspace.activeLeaf.view.editor.posToOffset(app.workspace.activeLeaf.view.editor.getCursor()), focus: document.activeElement?.id, marks: app.workspace.activeLeaf.view.contentEl.querySelectorAll(".inline-diff-source-mark").length }));
        assert.equal(state.marks, 0);
        if (position === "inside") assert.ok(state.cursor >= proposed.indexOf("{~~") && state.cursor < proposed.indexOf("~~}") + 3, "refresh must not move the remembered caret out of the proposal");
        if (focus === "elsewhere") assert.equal(state.focus, "qa-focus", "agent edits must not steal focus");
        assert.equal(await contents(), proposed);
        assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), proposed);
      } finally { await page.evaluate(() => document.querySelector("#qa-focus")?.remove()); }
    });
    await check("a freshly arrived proposal can be accepted and undone without first clicking the editor", async () => {
      await setFixture(page, original, "live");
      await page.evaluate(() => {
        const view = app.workspace.activeLeaf.view; view.editor.focus(); view.editor.setCursor(2, 8);
        const input = document.createElement("input"); input.id = "qa-focus"; document.body.append(input); input.focus();
      });
      try {
        await fs.writeFile(path.join(session.vault, "Review.md"), proposed);
        await page.waitForFunction(proposed => app.workspace.activeLeaf.view.editor.getValue() === proposed, proposed);
        await ready("live", 1);
        await page.locator(".markdown-source-view .inline-diff-changed").first().hover();
        await page.locator(".inline-diff-toolbar:visible [data-decision=accept]").click();
        await page.evaluate(async () => { await app.plugins.plugins["inline-diff"].lastResolution; await inlineDiffQa.save(app.workspace.activeLeaf.view); });
        const expected = "Intro.\n\nFood, water and livelihoods depend on one another.\n\nTail.\n";
        assert.equal(await contents(), expected);
        assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), expected);
        await page.keyboard.press("Meta+z"); assert.equal(await contents(), proposed);
      } finally { await page.evaluate(() => document.querySelector("#qa-focus")?.remove()); }
    });
    await check("deliberate native editing reveals source and blur restores the comparison", async () => {
      const text = "Intro.\n\nA {~~old~>new~~} sentence.\n\nTail.\n";
      await setFixture(page, text, "live"); await ready("live", 1);
      await page.evaluate(() => { const view = app.workspace.activeLeaf.view; view.editor.focus(); view.editor.setCursor(view.editor.offsetToPos(view.editor.getValue().indexOf("old"))); });
      await ready("source");
      await page.keyboard.insertText("x");
      const typed = text.replace("old", "xold");
      assert.equal(await contents(), typed);
      assert.equal(await page.locator(".markdown-source-view .inline-diff-review").count(), 0);
      await page.evaluate(() => { const input = document.createElement("input"); input.id = "qa-focus"; document.body.append(input); input.focus(); });
      try {
        await ready("live", 1);
        assert.equal(await page.evaluate(() => document.activeElement.id), "qa-focus");
        assert.equal(await contents(), typed);
      } finally { await page.evaluate(() => document.querySelector("#qa-focus")?.remove()); }
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus());
      await ready("source");
      assert.equal(await contents(), typed);
    });
    await check("agent edits refresh two panes with remembered carets inside the changed paragraph", async () => {
      await setFixture(page, original, "live");
      await page.evaluate(async () => {
        globalThis.qaOriginalLeaf = app.workspace.activeLeaf;
        globalThis.qaSecondLeaf = app.workspace.getLeaf("split");
        await qaSecondLeaf.openFile(app.vault.getAbstractFileByPath("Review.md"));
        await qaSecondLeaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: "source", source: false } });
        for (const leaf of [qaOriginalLeaf, qaSecondLeaf]) leaf.view.editor.setCursor(2, 8);
        app.workspace.setActiveLeaf(qaSecondLeaf, { focus: true }); qaSecondLeaf.view.editor.focus();
      });
      try {
        await fs.writeFile(path.join(session.vault, "Review.md"), proposed);
        await page.waitForFunction(proposed => [qaOriginalLeaf, qaSecondLeaf].every(leaf => leaf.view.editor.getValue() === proposed && leaf.view.contentEl.querySelector(".inline-diff-review[data-inline-diff-ready=true]")), proposed);
        assert.equal(await page.evaluate(() => app.workspace.activeLeaf === qaSecondLeaf), true);
      } finally { await page.evaluate(() => { qaSecondLeaf.detach(); app.workspace.setActiveLeaf(qaOriginalLeaf, { focus: true }); delete globalThis.qaSecondLeaf; delete globalThis.qaOriginalLeaf; }); }
    });
    for (const mode of ["live", "reading"]) await check(`${mode} comparison omits redundant UI and preserves hidden-change evidence`, async () => {
      const scope = page.locator(mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view");
      await setFixture(page, source, mode); await ready(mode);
      assert.equal(await scope.locator(".inline-diff-review .inline-diff-heading,.inline-diff-review .inline-diff-side-label,.inline-diff-review .inline-diff-source").count(), 0);
      assert.equal(await scope.locator(".inline-diff-review .inline-diff-before[aria-label=Before]").count(), 2);
      assert.equal(await scope.locator(".inline-diff-review .inline-diff-after[aria-label=After]").count(), 2);
      const hidden = "Intro.\n\nA {~~old~>new~~} word and {~~[Same label](Target.md)~>[Same label](Other.md)~~}.\n\nTail.\n";
      await setFixture(page, hidden, mode); await ready(mode, 1);
      const details = scope.locator(".inline-diff-review .inline-diff-source");
      assert.equal(await details.locator(".inline-diff-source-entry").count(), 1);
      assert.match(await details.textContent(), /Target\.md/);
      assert.match(await details.textContent(), /Other\.md/);
      assert.equal(await details.locator(".inline-diff-source-entry").getAttribute("tabindex"), mode === "reading" ? null : "0");
      if (mode === "reading") assert.equal(await page.locator(".inline-diff-toolbar,.markdown-reading-view .inline-diff-proposal-anchor").count(), 0);
      assert.equal(await contents(), hidden);
    });
    await check("Enter on a rendered link does not invoke review controls", async () => {
      const text = "Intro.\n\nA {~~[old label](Target.md)~>[new label](Other.md)~~} link.\n\nTail.\n";
      await setFixture(page, text, "live"); await ready("live", 1);
      await page.locator(".markdown-source-view .inline-diff-after a.internal-link").focus();
      await page.evaluate(() => document.activeElement.addEventListener("keydown", event => queueMicrotask(() => { globalThis.qaLinkPrevented = event.defaultPrevented; }), { once: true }));
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => globalThis.qaLinkPrevented), false);
      assert.equal(await page.locator(".inline-diff-toolbar button:focus").count(), 0);
      await page.evaluate(() => { delete globalThis.qaLinkPrevented; });
      assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), text);
    });
  }
  if (matches("safety")) await check("Reading creates no review toolbar", async () => {
    await setFixture(page, source, "reading");
    await page.evaluate(async () => {
      await app.plugins.disablePlugin("inline-diff"); await app.plugins.enablePlugin("inline-diff");
      app.workspace.activeLeaf.view.previewMode.rerender(true);
    });
    await ready("reading");
    assert.equal(await page.locator(".inline-diff-toolbar").count(), 0);
  });
  if (matches("themes")) {
    const themeRoot = process.env.OBSIDIAN_QA_THEME_ROOT;
    assert.ok(themeRoot, "Set OBSIDIAN_QA_THEME_ROOT to installed theme fixtures for the required theme suite.");
    measurements.themes = {};
    for (const theme of ["Primary", "Minimal", "Blue Topaz"]) {
      const target = path.join(session.vault, ".obsidian/themes", theme); await fs.mkdir(target, { recursive: true });
      for (const file of ["manifest.json", "theme.css"]) await fs.copyFile(path.join(themeRoot, theme, file), path.join(target, file));
      measurements.themes[theme] = JSON.parse(await fs.readFile(path.join(target, "manifest.json"), "utf8")).version;
    }
    await page.evaluate(() => app.customCss.readThemes());
    for (const theme of ["", "Primary", "Minimal", "Blue Topaz"]) for (const palette of ["light", "dark"]) {
      await page.evaluate(async ({ theme, palette }) => { await app.customCss.setTheme(theme); app.changeTheme(palette === "light" ? "moonstone" : "obsidian"); }, { theme, palette });
      await page.waitForFunction(palette => document.body.classList.contains(`theme-${palette}`), palette);
      for (const mode of ["source", "live", "reading"]) await check(`${theme || "Default"}/${palette}/${mode}/hover-layout`, async () => {
        await setFixture(page, source, mode); await ready(mode);
        if (mode !== "source") {
          const scope = page.locator(mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view");
          const colours = await scope.locator(".inline-diff-review .inline-diff-side").evaluateAll(elements => elements.map(element => {
            const canvas = element.ownerDocument.createElement("canvas"); canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d"); context.fillStyle = getComputedStyle(element).backgroundColor; context.fillRect(0, 0, 1, 1);
            return { before: element.classList.contains("inline-diff-before"), rgba: [...context.getImageData(0, 0, 1, 1).data] };
          }));
          assert.equal(colours.length, 4);
          for (const { before, rgba: [red, green, blue, alpha] } of colours) {
            assert.ok(alpha > 0 && alpha <= 32, "whole-block tint must be visible and very light");
            assert.ok(before ? red > green && red > blue : green > red && green > blue, "before/after panels must have red/green tints");
          }
        }
        if (mode === "reading") {
          await page.locator(".markdown-reading-view .inline-diff-review").first().hover();
          assert.equal(await page.locator(".inline-diff-toolbar:visible").count(), 0);
        } else {
          await prepareHover(mode); const before = await bounds(mode); await hoverFirst(mode); const after = await bounds(mode); equalBounds(before, after);
          if (mode === "source") {
            for (const kind of ["addition", "deletion"]) {
              const background = await page.locator(`.cm-content .inline-diff-${kind}`).first().evaluate(el => getComputedStyle(el).backgroundColor);
              assert.ok(background !== "transparent" && background !== "rgba(0, 0, 0, 0)", `${theme || "Default"} default ${kind} highlight must be visible`);
            }
            const strike = await page.locator(".cm-content .inline-diff-source-mark.cm-strikethrough,.cm-content .inline-diff-source-mark .cm-strikethrough,.cm-content .cm-strikethrough:has(.inline-diff-source-mark)").evaluateAll(elements => elements.map(el => getComputedStyle(el).textDecorationLine));
            assert.ok(strike.every(decoration => decoration === "none"), "replacement markers must not become native Markdown strike-through");
          }
          const sizes = await page.locator(".inline-diff-toolbar button svg").evaluateAll(icons => icons.map(icon => { const r = icon.getBoundingClientRect(); return [r.width, r.height]; }));
          assert.ok(sizes.every(([width, height]) => width >= 14 && height >= 14), "theme must not collapse icons");
          const button = page.locator(".inline-diff-toolbar:visible [data-decision=reject]");
          if (mode === "live") await page.screenshot({ path: path.resolve(".qa", `${theme || "Default"}-${palette}-live.png`) });
          await button.hover(); await button.click();
          await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
          assert.equal(await contents(), source.replace("{~~old~>new~~}", "old"));
          await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus());
          await page.keyboard.press("Meta+z"); assert.equal(await contents(), source);
          await page.keyboard.press("Meta+Shift+z"); assert.equal(await contents(), source.replace("{~~old~>new~~}", "old"));
        }
      });
      for (const mode of ["live", "reading"]) await check(`${theme || "Default"}/${palette}/${mode}/padded-prose-layout`, async () => {
        const before = "The service checks for updates every ten seconds and retries twice if a request fails. This keeps the interface responsive while reducing background traffic. The request is recorded so that the operator can review what happened.";
        const after = "The service checks for updates every thirty seconds and retries four times if a request fails. This reduces background traffic while giving temporary failures more time to recover. The request is recorded so that the operator can review what happened.";
        const wrap = text => `Above paragraph.\n\n${text}\n\nBelow paragraph.\n`;
        for (const width of [720, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          await setFixture(page, wrap(`{~~${before}~>${after}~~}`), mode); await ready(mode, 1);
          const diff = await proseGeometry(mode);
          await setFixture(page, wrap(before), mode); const nativeBefore = await proseGeometry(mode, diff.content[0].rect[2]);
          await setFixture(page, wrap(after), mode); const nativeAfter = await proseGeometry(mode, diff.content[1].rect[2]);
          const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) <= .5, `${label}: ${actual} instead of ${expected}`);
          assert.deepEqual([diff.outer.margin[0], diff.outer.margin[2]], [0, 0], "no extra outer vertical margin");
          assert.deepEqual(diff.outer.border, [0, 0, 0, 0], "no surrounding frame");
          assert.equal(diff.outer.shadow, "none", "no frame shadow");
          assert.deepEqual(diff.sideBorders, [[0, 0, 0, 3], [0, 0, 0, 3]], "only the coloured left borders remain");
          close(diff.content[0].rect[1] - diff.block[1], 8, "original top padding");
          close(diff.block[1] + diff.block[3] - diff.content[1].rect[1] - diff.content[1].rect[3], 8, "original bottom padding");
          close(diff.block[3], diff.content[0].rect[3] + diff.content[1].rect[3] + 32, "only original vertical padding adds height");
          for (const [index, native] of [nativeBefore, nativeAfter].entries()) {
            const actual = diff.content[index], expected = native.content[0];
            close(actual.rect[0] - diff.block[0], 15, "original left padding and indicator");
            close(diff.block[0] + diff.block[2] - actual.rect[0] - actual.rect[2], 12, "original right padding");
            for (const coordinate of [2, 3]) close(actual.rect[coordinate], expected.rect[coordinate], "native text bounds at the padded width");
            assert.equal(actual.lines.length, expected.lines.length, "native wrapping");
            for (let line = 0; line < expected.lines.length; line++) for (let coordinate = 0; coordinate < 4; coordinate++) close(actual.lines[line][coordinate], expected.lines[line][coordinate], "native line bounds");
          }
          await setFixture(page, wrap(`{~~${before}~>${after}~~}`), mode); await ready(mode, 1); await proseGeometry(mode);
          const layout = await bounds(mode);
          if (mode === "live") await hoverFirst("live"); else await page.locator(".markdown-reading-view .inline-diff-review").hover();
          equalBounds(layout, await bounds(mode));
          measurements.proseSpacing ??= {};
          measurements.proseSpacing[`${theme || "Default"}/${palette}/${mode}/${width}`] = { outerMargin: diff.outer.margin, sideBorders: diff.sideBorders, contentWidth: diff.content[0].rect[2], beforeLines: diff.content[0].lines.length, afterLines: diff.content[1].lines.length, verticalPadding: diff.block[3] - diff.content[0].rect[3] - diff.content[1].rect[3] };
        }
      });
    }
    await page.evaluate(async () => { await app.customCss.setTheme(""); app.changeTheme("moonstone"); });
  }

  if (matches("safety")) {
    await check("mode switch removes an existing toolbar", async () => {
      await setFixture(page, source, "live"); await ready("live"); await hoverFirst("live");
      await page.evaluate(async () => { await app.workspace.activeLeaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: "preview" } }); });
      await page.waitForFunction(() => !document.querySelector(".inline-diff-toolbar:not([hidden])"));
      assert.equal(await page.locator(".inline-diff-toolbar").count(), 0);
      assert.equal(await execute("accept-all-changes"), false); assert.equal(await contents(), source);
    });
    await check("shared table proposals resolve independently", async () => {
      await setFixture(page, source, "live"); await ready("live");
      await page.locator(".markdown-source-view .inline-diff-review").first().hover();
      await page.locator(".markdown-source-view .inline-diff-review").first().locator(".inline-diff-proposal-anchor").nth(1).hover();
      await page.locator(".inline-diff-toolbar:visible [data-decision=accept]").click();
      await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
      assert.equal(await contents(), source.replace("{~~old~>second~~}", "second"));
    });
    await check("keyboard focus reaches icon buttons and Escape restores the proposal", async () => {
      await setFixture(page, source, "live"); await ready("live");
      const anchor = page.locator(".markdown-source-view .inline-diff-proposal-anchor").first(); await anchor.focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Accept change");
      await page.keyboard.press("Escape"); assert.equal(await anchor.evaluate(el => el === el.ownerDocument.activeElement), true);
      await page.keyboard.press("Enter"); await page.keyboard.press("Space");
      await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
      assert.equal(await contents(), source.replace("{~~old~>new~~}", "new"));
    });
    await check("native save preserves CRLF, frontmatter and final-newline state", async () => {
      for (const bom of ["", "\uFEFF"]) for (const final of ["", "\r\n"]) {
        const text = bom + '---\r\nname: "{++literal++}"\r\n---\r\nA {~~old~>new~~} line.\r\n\r\nTail.' + final;
        await page.evaluate(async text => {
          let file = app.vault.getAbstractFileByPath("Line endings.md");
          if (file) await app.vault.modify(file, text); else file = await app.vault.create("Line endings.md", text);
          await app.workspace.activeLeaf.openFile(file);
          await app.workspace.activeLeaf.setViewState({ type: "markdown", state: { file: "Line endings.md", mode: "source", source: true } });
        }, text);
        await page.waitForFunction(text => { const v = app.workspace.activeLeaf.view; const normalize = s => s.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"); return normalize(v.editor.getValue()) === normalize(text) && normalize(v.data) === normalize(text); }, text);
        await execute("accept-all-changes"); await page.evaluate(() => app.workspace.activeLeaf.view.save());
        assert.equal(await fs.readFile(path.join(session.vault, "Line endings.md"), "utf8"), text.replace("{~~old~>new~~}", "new"));
      }
    });
    await check("identical alternatives preserve selected mixed endings through native undo and redo", async () => {
      for (const decision of ["accept", "reject"]) for (const bom of ["", "\uFEFF"]) {
        const raw = bom + "{~~\r\nsame\n~>\r\nsame\r\n~~}\r\n";
        const file = `Mixed-${decision}-${bom ? "BOM" : "plain"}.md`;
        await page.evaluate(async ({ file, raw }) => {
          const leaf = app.workspace.activeLeaf;
          await inlineDiffQa.save(leaf.view); await leaf.setViewState({ type: "empty", state: {} });
          const created = await app.vault.create(file, raw); await leaf.openFile(created);
          await leaf.setViewState({ type: "markdown", state: { file, mode: "source", source: true } });
        }, { file, raw });
        assert.equal(await execute(`${decision}-all-changes`), true);
        await page.evaluate(() => inlineDiffQa.save(app.workspace.activeLeaf.view));
        const expected = bom + (decision === "accept" ? "same\r\n" : "same\n");
        assert.equal(await fs.readFile(path.join(session.vault, file), "utf8"), expected);
        await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus());
        await page.keyboard.press("Meta+z"); await page.evaluate(() => inlineDiffQa.save(app.workspace.activeLeaf.view));
        assert.equal(await fs.readFile(path.join(session.vault, file), "utf8"), raw);
        await page.keyboard.press("Meta+Shift+z"); await page.evaluate(() => inlineDiffQa.save(app.workspace.activeLeaf.view));
        assert.equal(await fs.readFile(path.join(session.vault, file), "utf8"), expected);
      }
    });
    await check("active native table-cell editors do not duplicate review UI", async () => {
      const enterCell = async () => {
        await setFixture(page, source, "live"); await ready("live");
        await page.evaluate(() => {
          const view = app.workspace.activeLeaf.view;
          view.editor.setCursor(view.editor.offsetToPos(view.editor.getValue().indexOf("old")));
        });
        await page.locator(".markdown-source-view .cm-table-widget tbody tr").first().locator("td").nth(1).click();
        await page.waitForSelector(".cm-table-widget .cm-editor");
        await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await inlineDiffQa.save(app.workspace.activeLeaf.view); });
        assert.equal(await page.locator(".cm-table-widget .inline-diff-review").count(), 0);
      };
      const commitCell = async () => page.evaluate(async () => {
        const view = app.workspace.activeLeaf.view;
        view.editor.setCursor(view.editor.lastLine(), 0); view.editor.focus();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await inlineDiffQa.save(view);
      });
      // Compare with native cell editing, which can repad the Markdown table.
      await enterCell();
      await page.evaluate(() => {
        const e = app.workspace.activeLeaf.view.editor, at = e.getValue().indexOf("{~~old~>new~~}");
        e.replaceRange("new", e.offsetToPos(at), e.offsetToPos(at + "{~~old~>new~~}".length));
      });
      await commitCell(); const nativeResult = await contents();
      await enterCell();
      await page.evaluate(() => { const e = app.workspace.activeLeaf.view.editor; e.setCursor(e.offsetToPos(e.getValue().indexOf("old"))); });
      await page.evaluate(() => inlineDiffQa.observe(app.workspace.activeLeaf.view));
      assert.equal(await execute("accept-change"), true);
      const tableMeaning = text => text.split("\n").map(line => line.startsWith("|") ? line.split("|").map(cell => /^\s*:?-{2,}:?\s*$/.test(cell) ? cell.trim().replace(/-+/g, "---") : cell.trim()).join("|") : line).join("\n");
      await commitCell(); assert.equal(tableMeaning(await contents()), tableMeaning(nativeResult), "review matches native cell editing apart from native table padding");
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus()); await page.keyboard.press("Meta+z");
      await fs.writeFile(path.resolve(".qa", "cell-history.json"), JSON.stringify(await page.evaluate(() => inlineDiffQa.transactions), null, 2));
      assert.ok((await contents()).includes("{~~old~>new~~}"), "one native undo restores the active cell proposal");
      await page.locator(".markdown-source-view .cm-line").filter({ hasText: "Tail." }).click();
      await ready("live");
      assert.equal(await page.locator(".markdown-source-view .inline-diff-review").count(), 2);
    });
    await check("navigation commands select proposals and preserve note text", async () => {
      await setFixture(page, source, "source");
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.setCursor(0, 0));
      await execute("next-change");
      assert.equal(await page.evaluate(() => { const e = app.workspace.activeLeaf.view.editor; return e.posToOffset(e.getCursor()); }), source.indexOf("{~~old~>new~~}"));
      await execute("next-change");
      assert.equal(await page.evaluate(() => { const e = app.workspace.activeLeaf.view.editor; return e.posToOffset(e.getCursor()); }), source.indexOf("{~~old~>second~~}"));
      await execute("previous-change"); assert.equal(await contents(), source);
    });
    await check("stale targets cannot overwrite unsaved edits", async () => {
      await setFixture(page, source, "source"); await ready("source"); await hoverFirst("source");
      const result = await page.evaluate(async () => {
        const plugin = app.plugins.plugins["inline-diff"], target = plugin.overlay(document).target;
        app.workspace.activeLeaf.view.editor.replaceRange("Unsaved prefix.\n", { line: 0, ch: 0 });
        const before = app.workspace.activeLeaf.view.editor.getValue(); plugin.resolve(target, "accept");
        await plugin.lastResolution;
        return { before, after: app.workspace.activeLeaf.view.editor.getValue() };
      });
      assert.equal(result.after, result.before); assert.ok(result.after.startsWith("Unsaved prefix."));
    });
    await check("switching files with identical content invalidates captured targets", async () => {
      await setFixture(page, source, "source"); await ready("source"); await hoverFirst("source");
      await page.evaluate(async source => {
        globalThis.qaStale = app.plugins.plugins["inline-diff"].overlay(document).target;
        let other = app.vault.getAbstractFileByPath("Other proposal.md");
        if (!other) other = await app.vault.create("Other proposal.md", source); else await app.vault.modify(other, source);
        await app.workspace.activeLeaf.openFile(other);
        app.plugins.plugins["inline-diff"].resolve(globalThis.qaStale, "accept"); delete globalThis.qaStale;
        await app.plugins.plugins["inline-diff"].lastResolution;
      }, source);
      assert.equal(await contents(), source);
      assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), source);
    });
    await check("identical-content files receive fresh Live Preview targets", async () => {
      await setFixture(page, source, "live"); await ready("live");
      await page.evaluate(async source => {
        let other = app.vault.getAbstractFileByPath("Other proposal.md");
        if (!other) other = await app.vault.create("Other proposal.md", source); else await app.vault.modify(other, source);
        await app.workspace.activeLeaf.openFile(other);
        app.workspace.activeLeaf.view.editor.setCursor(app.workspace.activeLeaf.view.editor.lastLine(), 0);
      }, source);
      await ready("live"); await hoverFirst("live");
      await page.locator(".inline-diff-toolbar:visible [data-decision=accept]").click();
      await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
      assert.equal(await contents(), source.replace("{~~old~>new~~}", "new"));
      assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), source);
    });
    await check("edits arriving during the disk check cannot be overwritten", async () => {
      await setFixture(page, source, "source"); await ready("source"); await hoverFirst("source");
      const result = await page.evaluate(async () => {
        const plugin = app.plugins.plugins["inline-diff"], target = plugin.overlay(document).target, original = app.vault.adapter.readBinary;
        let release, armed = true;
        app.vault.adapter.readBinary = function(file) {
          if (armed && file === target.file.path) { armed = false; return new Promise(resolve => { release = resolve; }); }
          return original.call(this, file);
        };
        try {
          plugin.resolve(target, "accept");
          target.view.editor.replaceRange("New unsaved prefix.\n", { line: 0, ch: 0 });
          const before = target.view.editor.getValue(); release(new TextEncoder().encode(target.source).buffer); await plugin.lastResolution;
          return { before, after: target.view.editor.getValue() };
        } finally { app.vault.adapter.readBinary = original; }
      });
      assert.equal(result.after, result.before);
    });
    await check("a completed review does not steal focus from a newly selected pane", async () => {
      await setFixture(page, source, "source"); await ready("source"); await hoverFirst("source");
      const result = await page.evaluate(async () => {
        const plugin = app.plugins.plugins["inline-diff"], target = plugin.overlay(document).target, original = app.vault.adapter.readBinary;
        let release, armed = true;
        app.vault.adapter.readBinary = function(file) {
          if (armed && file === target.file.path) { armed = false; return new Promise(resolve => { release = resolve; }); }
          return original.call(this, file);
        };
        let other;
        try {
          plugin.resolve(target, "accept"); other = app.workspace.getLeaf("split");
          await other.openFile(app.vault.getAbstractFileByPath("Other.md")); app.workspace.setActiveLeaf(other, { focus: true });
          release(new TextEncoder().encode(target.source).buffer); await plugin.lastResolution;
          return { preserved: app.workspace.activeLeaf === other, result: target.view.editor.getValue() };
        } finally {
          app.vault.adapter.readBinary = original;
          const owner = app.workspace.getLeavesOfType("markdown").find(leaf => leaf.view === target.view);
          if (owner) app.workspace.setActiveLeaf(owner, { focus: true }); if (other) other.detach();
        }
      });
      assert.equal(result.preserved, true); assert.equal(result.result, source.replace("{~~old~>new~~}", "new"));
    });
    await check("agent file edits refresh and invalidate prior targets", async () => {
      await setFixture(page, source, "source"); await ready("source"); await hoverFirst("source");
      await page.evaluate(() => { globalThis.qaStale = app.plugins.plugins["inline-diff"].overlay(document).target; });
      const external = source.replace("Intro.", "Agent changed this.");
      await fs.writeFile(path.join(session.vault, "Review.md"), external);
      await page.waitForFunction(external => app.workspace.activeLeaf.view.editor.getValue() === external, external);
      await page.evaluate(async () => { app.plugins.plugins["inline-diff"].resolve(globalThis.qaStale, "accept"); delete globalThis.qaStale; await app.plugins.plugins["inline-diff"].lastResolution; });
      assert.equal(await contents(), external);
    });
    await check("bulk operations use a single undo transaction", async () => {
      for (const decision of ["accept", "reject"]) {
        await setFixture(page, source, "source"); await execute(`${decision}-all-changes`);
        const expected = decision === "accept" ? source.replace("{~~old~>new~~}", "new").replace("{~~old~>second~~}", "second").replace("{++new++}", "new") : source.replace("{~~old~>new~~}", "old").replace("{~~old~>second~~}", "old").replace("{++new++}", "");
        assert.equal(await contents(), expected);
        await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus()); await page.keyboard.press("Meta+z"); assert.equal(await contents(), source);
      }
    });
    await check("Reading remains read-only alongside an editable pane", async () => {
      await setFixture(page, source, "source");
      await page.evaluate(() => app.workspace.activeLeaf.view.editor.focus());
      await page.keyboard.press("Meta+Alt+y");
      await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
      assert.ok(!(await contents()).includes("{~~"), "the test shortcut must resolve changes in an editable pane");
      await setFixture(page, source, "live");
      await page.evaluate(async () => {
        globalThis.qaEditorLeaf = app.workspace.activeLeaf;
        const leaf = app.workspace.getLeaf("split");
        await leaf.openFile(app.vault.getAbstractFileByPath("Review.md"));
        await leaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: "preview" } }); app.workspace.setActiveLeaf(leaf, { focus: true });
      });
      await ready("reading"); assert.equal(await execute("reject-all-changes"), false);
      await page.locator(".markdown-reading-view .inline-diff-content").first().click();
      await page.keyboard.press("Meta+Alt+y");
      await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
      assert.equal(await contents(), source);
      assert.equal(await page.evaluate(() => qaEditorLeaf.view.editor.getValue()), source);
      await page.evaluate(() => { const reading = app.workspace.activeLeaf; app.workspace.setActiveLeaf(qaEditorLeaf, { focus: true }); reading.detach(); delete globalThis.qaEditorLeaf; });
    });
    await check("embedded notes and native hover previews expose no review actions", async () => {
      const original = await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath("Target.md")));
      const embedded = "# Section\n\n- [ ] A {~~old~>new~~} task.\n\nTail.\n";
      try {
        await page.evaluate(async text => app.vault.modify(app.vault.getAbstractFileByPath("Target.md"), text), embedded);
        for (const mode of ["live", "reading"]) {
          await setFixture(page, "Intro.\n\n![[Target]]\n\n[[Target]]\n\nTail.\n", mode);
          const root = mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view";
          const embed = page.locator(`${root} .markdown-embed-content .inline-diff-review[data-inline-diff-ready=true]`);
          await embed.waitFor(); await embed.hover();
          assert.equal(await embed.locator(".inline-diff-proposal-anchor,[data-decision]").count(), 0);
          assert.equal(await page.locator(".inline-diff-toolbar:visible").count(), 0);
        }
        const link = page.locator(".markdown-reading-view .markdown-preview-sizer > .el-p a.internal-link").last();
        await page.keyboard.down("Meta");
        try {
          await link.hover(); await page.locator(".hover-popover").waitFor();
          assert.equal(await page.locator(".hover-popover .inline-diff-proposal-anchor,.hover-popover [data-decision]").count(), 0);
          await page.locator(".hover-popover").hover();
          assert.equal(await page.locator(".inline-diff-toolbar:visible").count(), 0);
        } finally { await page.keyboard.up("Meta"); await page.mouse.move(5, 5); }
        assert.equal(await page.evaluate(() => app.vault.read(app.vault.getAbstractFileByPath("Target.md"))), embedded);
      } finally { await page.evaluate(async text => app.vault.modify(app.vault.getAbstractFileByPath("Target.md"), text), original); }
    });
    await check("renaming the note refreshes relative resources and review ownership", async () => {
      const text = "Intro.\n\n{~~![Old](./pixel.png)~>![New](./pixel.png)~~}\n\nTail.\n";
      await page.evaluate(async () => {
        await app.vault.createFolder("Moved");
        const bytes = await app.vault.adapter.readBinary("pixel.png");
        await app.vault.createBinary("Moved/pixel.png", bytes);
      });
      await setFixture(page, text, "live"); await ready("live", 1);
      try {
        await page.evaluate(async () => app.vault.rename(app.vault.getAbstractFileByPath("Review.md"), "Moved/Renamed.md"));
        await page.waitForFunction(() => { const images = [...app.workspace.activeLeaf.view.contentEl.querySelectorAll(".inline-diff-content img")]; return images.length === 2 && images.every(img => img.getAttribute("src")?.includes("Moved/pixel.png")); });
        await hoverFirst("live");
        await page.locator(".inline-diff-toolbar:visible [data-decision=accept]").click();
        await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
        assert.equal(await contents(), text.replace("{~~![Old](./pixel.png)~>![New](./pixel.png)~~}", "![New](./pixel.png)"));
      } finally {
        await page.evaluate(async () => { const file = app.vault.getAbstractFileByPath("Moved/Renamed.md"); if (file) await app.vault.rename(file, "Review.md"); });
      }
    });
    await check("literal constructs and malformed proposals are non-actionable", async () => {
      for (const mode of ["source", "live", "reading"]) {
        const literal = literalFixtures.join("\n\n"); await setFixture(page, literal, mode);
        assert.equal(await execute("accept-all-changes"), false); assert.equal(await contents(), literal);
        const malformed = "Intro.\n\n{++outer {--nested--}++}\n\nTail.\n";
        await setFixture(page, malformed, mode);
        await page.waitForSelector(mode === "reading" ? ".inline-diff-diagnostic-banner" : ".inline-diff-diagnostic");
        assert.equal(await execute("accept-all-changes"), false); assert.equal(await contents(), malformed);
      }
    });
    await check("document edges, empty arms, adjacency and frontmatter work in all views", async () => {
      for (const fixture of boundaryFixtures) for (const mode of ["source", "live", "reading"]) {
        const prepare = async () => {
          await setFixture(page, fixture.source, mode);
          if (mode === "live") await page.evaluate(() => { const e = app.workspace.activeLeaf.view.editor; e.setCursor(e.lastLine(), e.getLine(e.lastLine()).length); });
          await ready(mode, 1);
        };
        await prepare();
        if (mode === "reading") {
          assert.equal(await execute("accept-all-changes"), false); assert.equal(await contents(), fixture.source);
          assert.equal(await page.locator(".markdown-reading-view [data-decision],.markdown-reading-view .inline-diff-proposal-anchor").count(), 0);
        } else for (const [decision, expected] of [["accept", fixture.after], ["reject", fixture.before]]) {
          await prepare(); assert.equal(await execute(`${decision}-all-changes`), true);
          assert.equal(await contents(), expected, `${fixture.id}/${mode}/${decision}`);
          await page.evaluate(() => app.workspace.activeLeaf.view.save());
          assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), expected);
          await page.evaluate(() => inlineDiffQa.undo(app.workspace.activeLeaf.view));
          assert.equal(await contents(), fixture.source);
        }
      }
    });
    await check("rendered tasks and generated Bases comparisons cannot edit notes", async () => {
      const text = "Intro.\n\n{~~\n- [ ] Old task\n~>\n- [x] New task\n~~}\n\n{++\n```base\nfilters: 'file.name == \"Target\"'\nviews:\n  - type: table\n    name: Results\n```\n++}\n\nTail.\n";
      for (const mode of ["live", "reading"]) {
        await setFixture(page, text, mode); await ready(mode, 1);
        const root = mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view";
        const tasks = page.locator(`${root} .inline-diff-content input[type=checkbox]`);
        assert.equal(await tasks.count(), 2);
        assert.ok(await tasks.evaluateAll(inputs => inputs.every(input => input.disabled)));
        const box = await tasks.first().boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        const base = page.locator(`${root} .inline-diff-content .bases-embed,${root} .inline-diff-content .bases-view`);
        await base.first().waitFor(); assert.ok(await base.evaluateAll(views => views.every(view => view.inert)));
        assert.equal(await contents(), text); assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), text);
      }
    });
    await check("cross-block footnotes retain document numbering", async () => {
      const text = "Intro[^first].\n\nA {~~old~>new~~} claim[^second].\n\n[^first]: First footnote.\n[^second]: Second footnote.\n\nTail.\n";
      for (const mode of ["live", "reading"]) {
        await setFixture(page, text, mode); await ready(mode, 1);
        const refs = await page.locator(`${mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view"} .inline-diff-content .footnote-ref`).allTextContents();
        assert.deepEqual(refs, ["[2]", "[2]"]);
      }
    });
    await check("reference definitions inside code cannot override real document references", async () => {
      const text = "Intro.\n\nA {~~old~>new~~} [link][id].\n\n```md\n[id]: Wrong.md\n```\n\n[id]: Target.md\n\nTail.\n";
      for (const mode of ["live", "reading"]) {
        await setFixture(page, text, mode); await ready(mode, 1);
        const scope = mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view";
        const destinations = await page.locator(`${scope} .inline-diff-content a`).evaluateAll(links => links.map(link => link.getAttribute("href")));
        assert.deepEqual(destinations, ["Target.md", "Target.md"]);
      }
    });
    await check("configured colours apply in all views", async () => {
      await page.evaluate(async () => { const p = app.plugins.plugins["inline-diff"]; p.settings = { additionText: "#abcdef", additionBackground: "#123456", deletionText: "#fedcba", deletionBackground: "#654321" }; await p.saveSettings(); });
      for (const palette of ["light", "dark"]) {
        await page.evaluate(palette => app.changeTheme(palette === "light" ? "moonstone" : "obsidian"), palette);
        for (const theme of measurements.themes ? ["", "Primary", "Minimal", "Blue Topaz"] : [""]) {
          await page.evaluate(async theme => { await app.customCss.setTheme(theme); }, theme);
          for (const mode of ["source", "live", "reading"]) {
            await setFixture(page, source, mode); await ready(mode);
            for (const [kind, expected] of [["addition", ["rgb(171, 205, 239)", "rgb(18, 52, 86)"]], ["deletion", ["rgb(254, 220, 186)", "rgb(101, 67, 33)"]]]) {
              const selector = mode === "source" ? `.cm-content .inline-diff-${kind}` : `${mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view"} .inline-diff-changed.inline-diff-${kind}`;
              assert.deepEqual(await page.locator(selector).first().evaluate(el => { const style = getComputedStyle(el); return [style.color, style.backgroundColor]; }), expected, `${theme || "Default"}/${mode}/${kind} configured colours`);
            }
          }
        }
      }
      await page.evaluate(async () => { await app.customCss.setTheme(""); app.changeTheme("moonstone"); });
      await page.evaluate(async () => { const p = app.plugins.plugins["inline-diff"]; p.settings = { additionText: "", additionBackground: "", deletionText: "", deletionBackground: "" }; await p.saveSettings(); });
    });
    await check("native settings controls save and reset all four colours", async () => {
      await page.evaluate(() => { app.setting.open(); app.setting.openTabById("inline-diff"); });
      let settingsPage;
      for (let attempt = 0; attempt < 100; attempt++) {
        for (const candidate of session.browser.contexts()[0].pages()) {
          if (await candidate.locator("input[placeholder='Theme default']").count()) { settingsPage = candidate; break; }
        }
        if (settingsPage) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(settingsPage, "native settings window"); settingsPage.setDefaultTimeout(15000);
      const inputs = settingsPage.locator("input[placeholder='Theme default']");
      await inputs.first().waitFor(); assert.equal(await inputs.count(), 4);
      const colours = ["#135790", "#246801", "#abcdef", "#fedcba"];
      for (const [index, colour] of colours.entries()) await inputs.nth(index).fill(colour);
      await page.waitForFunction(colours => JSON.stringify(Object.values(app.plugins.plugins["inline-diff"].settings)) === JSON.stringify(colours), colours);
      await settingsPage.getByRole("button", { name: "Reset", exact: true }).click();
      await page.waitForFunction(() => Object.values(app.plugins.plugins["inline-diff"].settings).every(value => value === ""));
      await page.evaluate(() => app.setting.close());
    });
    await check("repeated redraw and plugin reload leave no duplicate layers", async () => {
      for (let cycle = 0; cycle < 20; cycle++) { const mode = cycle % 2 ? "live" : "reading"; await setFixture(page, source, mode); await ready(mode); }
      await page.evaluate(async () => { await app.plugins.disablePlugin("inline-diff"); });
      assert.equal(await page.locator(".inline-diff-review,.inline-diff-toolbar,.inline-diff-hidden,.inline-diff-host").count(), 0);
      await page.evaluate(async () => { await app.plugins.enablePlugin("inline-diff"); });
      await setFixture(page, source, "live"); await ready("live");
      await hoverFirst("live");
      assert.equal(await page.locator(".inline-diff-toolbar").count(), 1);
    });
  }

  if (matches("geometry")) {
    for (const width of [720, 1280]) await check(`narrow pane ${width}px and horizontal table scrolling`, async () => {
      await page.setViewportSize({ width, height: 800 });
      await setFixture(page, source.replace("| Item | Value |", "| Item with a very long heading | Value with another long heading |"), "live"); await ready("live");
      await prepareHover("live"); const before = await bounds("live"); await hoverFirst("live"); equalBounds(before, await bounds("live"));
      const box = await page.locator(".inline-diff-toolbar").boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= width);
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    for (const zoom of [1, 1.25, 1.5]) await check(`hover placement at ${zoom * 100}% zoom`, async () => {
      await page.evaluate(zoom => require("electron").webFrame.setZoomFactor(zoom), zoom);
      await setFixture(page, source, "live"); await ready("live"); await prepareHover("live"); const before = await bounds("live"); await hoverFirst("live"); equalBounds(before, await bounds("live"));
    });
    await page.evaluate(() => require("electron").webFrame.setZoomFactor(1));
    await check("folding, delayed embeds and scrolling preserve anchors", async () => {
      const text = "Intro.\n\n> [!note]- Folded\n> {~~old~>new~~}\n\n{++![[Late.png|30]]++}\n\n" + "Unchanged paragraph.\n\n".repeat(40) + "Tail.\n";
      await setFixture(page, text, "live"); await ready("live");
      await page.locator(".inline-diff-review .callout-title").first().click();
      const png = await fs.readFile(path.join(session.vault, "pixel.png")); await fs.writeFile(path.join(session.vault, "Late.png"), png);
      await page.waitForFunction(() => [...document.querySelectorAll('.inline-diff-review img')].some(image => image.complete && image.naturalWidth > 0));
      await page.locator(".inline-diff-proposal-anchor").first().scrollIntoViewIfNeeded(); await hoverFirst("live");
      await page.evaluate(() => { app.workspace.activeLeaf.view.contentEl.querySelector(".cm-scroller").scrollTop = 500; });
      await page.waitForFunction(() => !document.querySelector(".inline-diff-toolbar:not([hidden])"));
    });
    await check("asynchronous layout above a hovered change updates its toolbar", async () => {
      const text = "Intro.\n\n![[LateLayout.png|600]]\n\nA {~~old~>new~~} sentence.\n\nTail.\n";
      await setFixture(page, text, "live"); await ready("live", 1); await hoverFirst("live");
      await fs.copyFile(path.join(session.vault, "pixel.png"), path.join(session.vault, "LateLayout.png"));
      await page.waitForFunction(() => [...document.querySelectorAll('.markdown-source-view img')].some(image => image.complete && image.naturalWidth > 0));
      await page.waitForFunction(() => {
        const anchor = document.querySelector(".markdown-source-view .inline-diff-proposal-anchor");
        const toolbar = document.querySelector(".inline-diff-toolbar");
        const pane = app.workspace.activeLeaf.view.containerEl.getBoundingClientRect(), rect = anchor.getBoundingClientRect();
        if (rect.top > pane.bottom || rect.bottom < pane.top) return !toolbar;
        if (!toolbar) return false;
        const box = toolbar.getBoundingClientRect(), expected = Math.max(pane.top + 4, Math.min(rect.top - box.height + 4, pane.bottom - box.height - 4, innerHeight - box.height - 4));
        return Math.abs(box.top - expected) <= .5;
      });
    });
  }

  if (matches("popout")) await check("popout controls use their own document and clean up on close", async () => {
    await setFixture(page, source, "live"); await ready("live");
    await page.evaluate(async () => {
      globalThis.qaPopoutLeaf = app.workspace.openPopoutLeaf();
      await qaPopoutLeaf.openFile(app.vault.getAbstractFileByPath("Review.md"));
      await qaPopoutLeaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: "source", source: false } });
      qaPopoutLeaf.view.editor.setCursor(qaPopoutLeaf.view.editor.lastLine(), 0);
    });
    let popup;
    for (let attempt = 0; attempt < 100; attempt++) {
      for (const candidate of session.browser.contexts()[0].pages()) {
        if (candidate !== page && await candidate.locator(".markdown-source-view").count()) { popup = candidate; break; }
      }
      if (popup) break; await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(popup, "native popout page");
    await popup.waitForSelector(".inline-diff-proposal-anchor"); await popup.locator(".inline-diff-review").first().hover(); await popup.locator(".inline-diff-proposal-anchor").first().hover();
    await popup.locator(".inline-diff-toolbar:visible [data-decision=accept]").click();
    await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
    assert.equal(await page.evaluate(() => qaPopoutLeaf.view.editor.getValue()), source.replace("{~~old~>new~~}", "new"));
    await page.evaluate(() => { qaPopoutLeaf.detach(); delete globalThis.qaPopoutLeaf; });
    await page.waitForFunction(() => app.plugins.plugins["inline-diff"].overlays.size <= 1);
  });

  if (matches("performance")) {
    await check("ordinary hover handling stays below 100 ms", async () => {
      measurements.hover = {};
      for (const mode of ["source", "live"]) {
        await setFixture(page, source, mode); await ready(mode); await prepareHover(mode);
        const result = await page.evaluate(async mode => {
          const anchor = document.querySelector(mode === "source" ? ".cm-content .inline-diff-source-mark" : ".markdown-source-view .inline-diff-proposal-anchor");
          const times = [];
          for (let i = 0; i < 20; i++) {
            const start = performance.now();
            anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
            document.querySelector(".inline-diff-toolbar").getBoundingClientRect();
            times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b); return { p95: times[19], max: times[19] };
        }, mode);
        measurements.hover[mode] = result; assert.ok(result.p95 < 100);
      }
    });
    for (const [bytes, count] of [[100000, 200], [1000000, 1000]]) await check(`performance ${bytes} bytes / ${count} proposals`, async () => {
    const paragraph = "Unchanged text ".repeat(Math.ceil(bytes / count / 15));
    const text = Array.from({ length: count }, (_, index) => `${paragraph}{~~old${index}~>new${index}~~}.\n\n`).join("") + "Tail.\n";
    const result = await page.evaluate(async text => {
      const leaf = app.workspace.activeLeaf;
      await leaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: "source", source: true } });
      const editor = leaf.view.editor, times = [];
      const start = performance.now(); editor.setValue(text); const initial = performance.now() - start;
      for (let index = 0; index < 20; index++) {
        const time = performance.now(); editor.replaceRange("x", { line: editor.lastLine(), ch: 0 }); times.push(performance.now() - time);
      }
      times.sort((a, b) => a - b);
      return { initial, p95: times[Math.floor(times.length * .95)], max: times[times.length - 1] };
    }, text);
    measurements[`${bytes}/${count}`] = result;
    if (bytes === 100000) assert.ok(result.p95 < 100, `input p95 ${result.p95} ms`);
    for (const mode of ["live", "reading"]) {
      await page.evaluate(async mode => {
        const leaf = app.workspace.activeLeaf; await inlineDiffQa.save(leaf.view);
        await leaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: mode === "reading" ? "preview" : "source", source: false } });
        if (mode === "live") { leaf.view.editor.setCursor(0, 0); leaf.view.editor.scrollIntoView({from:{line:0,ch:0},to:{line:0,ch:0}},true); }
      }, mode);
      await page.waitForSelector(`${mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view"} .inline-diff-review[data-inline-diff-ready=true]`);
      const rendered = await page.locator(`${mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view"} .inline-diff-review`).count();
      measurements[`${bytes}/${count}`][`${mode}Rendered`] = rendered;
      assert.ok(rendered < count / 2, `offscreen ${mode} comparisons should stay unrendered: ${rendered}/${count}`);
    }
    });
  }

  assert.deepEqual(errors, [], "plugin console errors");
  await setFixture(page, source, "live"); await ready("live"); await hoverFirst("live");
  await page.screenshot({ path: path.resolve(".qa", "review-live.png") });
  await setFixture(page, source, "reading"); await ready("reading");
  await page.screenshot({ path: path.resolve(".qa", "review-reading.png") });
  await setFixture(page, source, "source"); await ready("source"); await prepareHover("source"); await hoverFirst("source");
  await page.screenshot({ path: path.resolve(".qa", "review-source.png") });
  const code = "Intro.\n\n{~~\n```js\nconst timeout = 10;\n```\n~>\n```js\nconst timeout = 30;\n```\n~~}\n\nTail.\n";
  await setFixture(page, code, "live"); await ready("live", 1); await hoverFirst("live");
  await page.screenshot({ path: path.resolve(".qa", "review-code.png") });
} finally {
  await fs.writeFile(path.resolve(".qa", "interactions-report.json"), JSON.stringify({ date: new Date().toISOString(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, artifacts: session.artifacts, passed, measurements, errors }, null, 2));
  console.log(JSON.stringify({ passed: passed.length, measurements, errors }));
  await session.close();
}
