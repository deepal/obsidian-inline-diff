import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseNote } from "../src/model.ts";
import { connectSession, installOracle, setFixture } from "./qa-client.mjs";

const session = await connectSession(), { page } = session;
const passed = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error" && /inline.diff|plugin:inline-diff/i.test(message.text())) errors.push(message.text()); });
const check = async (name, run) => { await run(); passed.push(name); console.log(`PASS ${name}`); };
const fixture = count => "Intro.\n\n" + Array.from({ length: count }, (_, index) =>
  `${"Unchanged paragraph.\n\n".repeat(30)}Change ${index + 1}: {~~same~>new ${index + 1}~~}.\n\n`).join("") + "Tail.\n";

async function barReady(count, mode, editable = mode !== "reading") {
  await page.waitForFunction(({ count, editable }) => {
    const bar = app.workspace.activeLeaf.view.contentEl.querySelector(".inline-diff-review-bar");
    if (!bar || bar.hidden) return count === 0;
    return bar.querySelector(".inline-diff-review-bar-count").textContent === `${count} pending ${count === 1 ? "change" : "changes"}` &&
      bar.getAttribute("aria-busy") === "false" && bar.querySelectorAll("[data-direction]").length === 2 &&
      [...bar.querySelectorAll("[data-direction]")].every(button => button.disabled === (count <= 1)) &&
      bar.querySelectorAll("[data-decision]").length === (editable ? 2 : 0);
  }, { count, editable });
}

async function navigate(direction, index, count, key, scope = ".workspace-leaf.mod-active", currentPage = page) {
  const bar = currentPage.locator(`${scope} .inline-diff-review-bar`), button = bar.locator(`[data-direction="${direction}"]`);
  if (key) { await button.focus(); await currentPage.keyboard.press(key); } else await button.click();
  await currentPage.waitForFunction(({ scope, index, count }) => {
    const bar = document.querySelector(`${scope} .inline-diff-review-bar`);
    return bar?.getAttribute("aria-busy") === "false" && bar.querySelector(".inline-diff-navigation-status")?.textContent === `Change ${index} of ${count}`;
  }, { scope, index, count }, { polling: 25 });
  // Read the short-lived outline and focus in one browser turn. Background
  // requestAnimationFrame throttling must not outlast its 1.5 second lifetime.
  const geometry = await bar.evaluate((bar,direction) => {
    const view = bar.parentElement, target = view.querySelector(".inline-diff-navigation-target");
    const surface = target?.closest(".cm-scroller,.markdown-preview-view");
    if (!target || !surface) {
      const navigator = [...app.plugins.plugins["inline-diff"].reviewBars.bars.values()].find(candidate => candidate.element === bar)?.navigator;
      return { missing: true, message: navigator?.message, highlights: navigator?.highlights.map(element => ({ connected: element.isConnected, cls: element.className, id: element.dataset.inlineDiffId })), marks: [...view.querySelectorAll(".inline-diff-source-mark")].map(element => element.dataset.inlineDiffId) };
    }
    const a = target.getBoundingClientRect(), b = surface.getBoundingClientRect();
    return { focused: bar.ownerDocument.activeElement === bar.querySelector(`[data-direction="${direction}"]`), visible: a.bottom > b.top && a.top < b.bottom, offset: a.top - b.top, atBottom: surface.scrollTop + surface.clientHeight >= surface.scrollHeight - 1 };
  }, direction);
  assert.ok(geometry?.visible, `destination is visible inside its pane: ${JSON.stringify({index,count,key,geometry})}`);
  assert.equal(geometry.focused, true, "arrow retains focus");
  assert.ok(Math.abs(geometry.offset - 16) <= 1 || geometry.atBottom && geometry.offset >= 16, `destination has top margin or is clamped at the document end: ${JSON.stringify(geometry)}`);
}

async function state() {
  return page.evaluate(() => {
    const view = app.workspace.activeLeaf.view;
    return { source: view.getViewData(), selection: view.editor.cm.state.selection.toJSON(), history: inlineDiffQa.historyDepth(view) };
  });
}

try {
  await installOracle(session);
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const mode of ["source", "live", "reading"].filter(mode => !process.env.QA_NAV_MODE || mode === process.env.QA_NAV_MODE)) {
    for (const count of [0, 1, 2, 8, 12]) await check(`${mode}/${count} changes: availability, order, wrap, focus and unchanged document`, async () => {
      const source = fixture(count);
      await setFixture(page, source, mode); await barReady(count, mode);
      const before = await state();
      if (count === 1) {
        const result = await page.locator(".inline-diff-review-bar").evaluate(bar => {
          const buttons = [...bar.querySelectorAll("[data-direction]")];
          for (const button of buttons) button.click();
          return { disabled: buttons.every(button => button.disabled), message: bar.querySelector(".inline-diff-navigation-status").textContent };
        });
        assert.deepEqual(result, { disabled: true, message: "" });
      } else if (count > 1) {
        await navigate(1, 1, count);
        for (let index = 2; index <= count; index++) await navigate(1, index, count, index % 2 ? "Enter" : "Space");
        await navigate(1, 1, count);
        await navigate(-1, count, count, "Enter");
        for (let index = count - 1; index >= 1; index--) await navigate(-1, index, count);
        if (mode !== "source") assert.ok(await page.locator(`${mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view"} .inline-diff-review`).count() > 0);
      }
      assert.deepEqual(await state(), before, "navigation preserves text, cursor, selection and history");
      assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), source);
      if (count === 2) await page.screenshot({ path: path.resolve(".qa", `navigation-${mode}.png`) });
    });
    if(mode==='source')await check('source/outline survives native editor reconfiguration',async()=>{
      await setFixture(page,fixture(2),mode);await barReady(2,mode);await navigate(1,1,2);
      const before=await state();
      const visible=await page.evaluate(()=>{
        const view=app.workspace.activeLeaf.view;inlineDiffQa.redraw(view);
        return !!view.contentEl.querySelector('.inline-diff-navigation-target');
      });
      assert.equal(visible,true,'the outline remains owned by the editor after redraw');assert.deepEqual(await state(),before);
    });
    await check(`${mode}/manual scrolling resets the viewport origin`, async () => {
      const source = fixture(6), proposals = parseNote(source).proposals;
      await setFixture(page, source, mode); await barReady(6, mode);
      await navigate(1, 1, 6);
      const line = source.slice(0, proposals[3].from).split("\n").length - 12;
      await page.evaluate(line => app.workspace.activeLeaf.view.currentMode.applyScroll(line), line);
      await page.waitForFunction(() => !app.workspace.activeLeaf.view.contentEl.querySelector(".inline-diff-navigation-status").textContent);
      await navigate(1, 4, 6); await navigate(-1, 3, 6);
    });
    await check(`${mode}/shared comparison steps through identical proposals independently`, async () => {
      const source = "Intro.\n\nA {~~same~>new~~} and {~~same~>new~~}.\n\n| Key | Value |\n| --- | --- |\n| A | {++one++} |\n| B | {++two++} |\n\n{~~\nOld paragraph.\n\nOld second paragraph.\n~>\nNew paragraph.\n\nNew second paragraph.\n~~}\n\nTail.\n" + "Trailing paragraph.\n\n".repeat(50);
      await setFixture(page, source, mode); await barReady(5, mode);
      for (let index = 1; index <= 5; index++) await navigate(1, index, 5);
      await navigate(1, 1, 5); await navigate(-1, 5, 5);
      assert.equal((await state()).source, source);
    });
    await check(`${mode}/external updates cover 0→1→2→many→2→1→0`, async () => {
      await setFixture(page, fixture(0), mode); await barReady(0, mode);
      for (const count of [1, 2, 8, 2, 1, 0]) {
        await fs.writeFile(path.join(session.vault, "Review.md"), fixture(count)); await barReady(count, mode);
        assert.equal(await page.locator(".inline-diff-navigation-status").textContent().catch(() => ""), "");
      }
    });
    await check(`${mode}/navigation after a review preserves BOM/CRLF bytes and renderer offsets`, async () => {
      const raw = "\uFEFF" + fixture(3).replace(/\n/g, "\r\n");
      await page.evaluate(async raw => {
        const path = "Navigation line endings.md";
        const file = app.vault.getAbstractFileByPath(path) ?? await app.vault.create(path, raw);
        await app.vault.modify(file, raw);
        await app.workspace.activeLeaf.openFile(file);
        await app.workspace.activeLeaf.setViewState({ type: "markdown", state: { file: path, mode: "source", source: true } });
      }, raw);
      await page.waitForFunction(() => app.plugins.plugins["inline-diff"].readReviewSnapshot(app.workspace.activeLeaf.view)?.pending === 3);
      await page.evaluate(async mode => {
        const view = app.workspace.activeLeaf.view, plugin = app.plugins.plugins["inline-diff"];
        const snapshot = plugin.readReviewSnapshot(view), note = plugin.editorModel.parsedNote(view.editor.cm.state);
        plugin.resolve({ ...snapshot, proposal: note.proposals[0] }, "accept");
        await plugin.lastResolution; await inlineDiffQa.save(view);
        await app.workspace.activeLeaf.setViewState({ type: "markdown", state: { file: view.file.path, mode: mode === "reading" ? "preview" : "source", source: mode === "source" } });
        view.currentMode.applyScroll(0);
      }, mode);
      await barReady(2, mode);
      const expected = raw.replace("{~~same~>new 1~~}", "new 1"), before = await state();
      assert.equal(await fs.readFile(path.join(session.vault, "Navigation line endings.md"), "utf8"), expected);
      await navigate(1, 1, 2); await navigate(1, 2, 2, "Space");
      assert.deepEqual(await state(), before);
      assert.equal(await fs.readFile(path.join(session.vault, "Navigation line endings.md"), "utf8"), expected);
    });
    await check(`${mode}/folded headings reveal the target`, async () => {
      const source = "Intro.\n\n# Folded\n\n{++first++}\n\n{++second++}\n\n# Other\n\nOther paragraph.\n\n" + "Trailing paragraph.\n\n".repeat(40);
      await setFixture(page, source, mode); await barReady(2, mode);
      assert.equal(await page.evaluate(() => app.commands.executeCommandById("editor:fold-all")), true);
      await navigate(1, 1, 2); await navigate(1, 2, 2, "Space");
      assert.equal((await state()).source, source);
    });
    await check(`${mode}/literal and malformed markers stay outside navigation`, async () => {
      const source = '---\ntitle: "{++literal++}"\n---\n`{++code++}`\n\n{++valid one++}\n\n{~~broken~~}\n\n{--valid two--}\n\n' + "Trailing paragraph.\n\n".repeat(40);
      await setFixture(page, source, mode); await barReady(2, mode);
      await navigate(1, 1, 2); await navigate(1, 2, 2); await navigate(1, 1, 2);
    });
    if (mode !== "reading") await check(`${mode}/read-only panes retain working arrows without mutation controls`, async () => {
      await setFixture(page, fixture(2), mode); await barReady(2, mode);
      await page.evaluate(() => inlineDiffQa.makeReadOnly(app.workspace.activeLeaf.view));
      await barReady(2, mode, false);
      const before = await state();
      await navigate(1, 1, 2); await navigate(1, 2, 2, "Space");
      assert.deepEqual(await state(), before);
    });
    if (mode !== "reading") await check(`${mode}/navigation preserves a nonempty selection inside a proposal`, async () => {
      const source = fixture(2), proposal = parseNote(source).proposals[0];
      await setFixture(page, source, mode); await barReady(2, mode);
      await page.evaluate(({ from, to }) => {
        const view = app.workspace.activeLeaf.view, editor = view.editor;
        editor.setSelection(editor.offsetToPos(from + 3), editor.offsetToPos(to - 3));
        editor.focus(); view.currentMode.applyScroll(0);
      }, proposal);
      const before = await state();
      assert.notEqual(before.selection.ranges[0].anchor, before.selection.ranges[0].head);
      await navigate(1, 1, 2); await navigate(1, 2, 2, "Enter");
      assert.deepEqual(await state(), before);
      if (mode === "live") assert.ok(await page.locator(".inline-diff-navigation-target.inline-diff-unit").count() >= 1);
    });
    for (const reason of ["manual scroll", "mode change", "plugin reload"]) await check(`${mode}/${reason} cancels pending navigation`, async () => {
      await setFixture(page, fixture(2), mode); await barReady(2, mode);
      const result = await page.evaluate(async ({ reason, mode }) => {
        const plugin = app.plugins.plugins["inline-diff"], leaf = app.workspace.activeLeaf;
        const bar = plugin.reviewBars.bars.get(leaf.view), navigator = bar.navigator;
        leaf.view.contentEl.querySelector('[data-direction="1"]').click();
        if (reason === "manual scroll") leaf.view.contentEl.querySelector(mode === "reading" ? ".markdown-preview-view" : ".cm-scroller").dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 100 }));
        if (reason === "mode change") await leaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: mode === "reading" ? "source" : "preview", source: true } });
        if (reason === "plugin reload") { await app.plugins.disablePlugin("inline-diff"); await app.plugins.enablePlugin("inline-diff"); }
        app.plugins.plugins["inline-diff"].reviewBars.refresh();
        return { busy: navigator.busy, message: navigator.message, waits: navigator.waits.size, scope: bar.navigation?.scopeActive ?? false };
      }, { reason, mode });
      assert.equal(result.busy, false); assert.equal(result.message, ""); assert.equal(result.waits, 0);
      if (reason === "plugin reload") assert.equal(result.scope, false);
      await page.waitForFunction(() => app.workspace.activeLeaf.view.contentEl.querySelectorAll(".inline-diff-review-bar").length === 1);
    });
    await check(`${mode}/closing the pane during navigation cancels pending work`, async () => {
      await setFixture(page, fixture(2), mode); await barReady(2, mode);
      const result = await page.evaluate(async () => {
        const owner = app.workspace.activeLeaf, view = owner.view, bar = app.plugins.plugins["inline-diff"].reviewBars.bars.get(view);
        view.contentEl.querySelector('[data-direction="1"]').click();
        await owner.setViewState({ type: "empty", state: {} });
        app.plugins.plugins["inline-diff"].reviewBars.refresh();
        return { busy: bar.navigator.busy, waits: bar.navigator.waits.size, connected: bar.element.isConnected };
      });
      assert.deepEqual(result, { busy: false, waits: 0, connected: false });
    });
    for (const decision of ["accept", "reject"]) await check(`${mode}/${decision} updates arrows through decisions and undo/redo`, async () => {
      const source = fixture(3);
      await setFixture(page, source, mode === "reading" ? "source" : mode);
      await page.evaluate(async mode => {
        globalThis.qaNavigationOwner = app.workspace.activeLeaf;
        if (mode === "reading") {
          globalThis.qaNavigationReader = app.workspace.getLeaf("split");
          await qaNavigationReader.openFile(qaNavigationOwner.view.file);
          await qaNavigationReader.setViewState({ type: "markdown", state: { file: "Review.md", mode: "preview" } });
          app.workspace.setActiveLeaf(qaNavigationReader, { focus: true });
        }
      }, mode);
      try {
        await barReady(3, mode);
        for (const count of [2, 1, 0]) {
          await page.evaluate(async decision => {
            app.workspace.setActiveLeaf(qaNavigationOwner, { focus: true });
            const plugin = app.plugins.plugins["inline-diff"], view = qaNavigationOwner.view;
            const snapshot = plugin.readReviewSnapshot(view), note = plugin.editorModel.parsedNote(view.editor.cm.state);
            plugin.resolve({ ...snapshot, proposal: note.proposals[0] }, decision);
            await plugin.lastResolution; await inlineDiffQa.save(view);
            if (globalThis.qaNavigationReader) app.workspace.setActiveLeaf(qaNavigationReader, { focus: true });
          }, decision);
          await barReady(count, mode);
        }
        for (const [operation, count] of [["undo", 1], ["undo", 2], ["redo", 1], ["undo", 2]]) {
          await page.evaluate(async operation => {
            inlineDiffQa[operation](qaNavigationOwner.view); await inlineDiffQa.save(qaNavigationOwner.view);
          }, operation);
          await barReady(count, mode);
        }
        await page.evaluate(async decision => {
          const plugin = app.plugins.plugins["inline-diff"];
          plugin.resolveAll(plugin.readReviewSnapshot(qaNavigationOwner.view), decision); await plugin.lastResolution;
          await inlineDiffQa.save(qaNavigationOwner.view);
        }, decision);
        await barReady(0, mode);
      } finally {
        await page.evaluate(() => {
          globalThis.qaNavigationReader?.detach(); app.workspace.setActiveLeaf(qaNavigationOwner, { focus: true });
          delete globalThis.qaNavigationOwner; delete globalThis.qaNavigationReader;
        });
      }
    });
    for (const palette of ["light", "dark"]) await check(`${mode}/${palette}/narrow panel and keyboard navigation`, async () => {
      await page.setViewportSize({ width: 600, height: 800 });
      await page.evaluate(palette => app.changeTheme(palette === "light" ? "moonstone" : "obsidian"), palette);
      await setFixture(page, fixture(2), mode); await barReady(2, mode);
      const layout = await page.locator(".inline-diff-review-bar").evaluate(bar => {
        const box = bar.getBoundingClientRect();
        return bar.scrollWidth <= bar.clientWidth + .5 && [...bar.querySelectorAll("button")].every(button => {
          const rect = button.getBoundingClientRect(); return rect.left >= box.left && rect.right <= box.right + .5 && rect.top >= box.top && rect.bottom <= box.bottom + .5;
        });
      });
      assert.equal(layout, true); await navigate(1, 1, 2, "Enter"); await navigate(-1, 2, 2, "Space");
      await page.setViewportSize({ width: 1280, height: 900 });
    });
    await check(`${mode}/split panes navigate independently`, async () => {
      await setFixture(page, fixture(3), mode); await barReady(3, mode);
      await page.evaluate(async ({ source, mode }) => {
        globalThis.qaNavigationOwner = app.workspace.activeLeaf; qaNavigationOwner.view.contentEl.dataset.qaNavigation = "owner";
        const file = app.vault.getAbstractFileByPath("Navigation other.md") ?? await app.vault.create("Navigation other.md", source);
        await app.vault.modify(file, source);
        globalThis.qaNavigationOther = app.workspace.getLeaf("split"); await qaNavigationOther.openFile(file);
        await qaNavigationOther.setViewState({ type: "markdown", state: { file: file.path, mode: mode === "reading" ? "preview" : "source", source: mode === "source" } });
        qaNavigationOther.view.contentEl.dataset.qaNavigation = "other";
        app.plugins.plugins["inline-diff"].reviewBars.refresh();
      }, { source: fixture(2), mode });
      try {
        // Reading returns null until its native section renderer initializes.
        // Capture a real scroll position before comparing independent panes.
        await page.waitForFunction(() => Number.isFinite(qaNavigationOther.view.currentMode.getScroll()));
        const otherScroll = await page.evaluate(() => qaNavigationOther.view.currentMode.getScroll());
        await navigate(1, 1, 3, undefined, '[data-qa-navigation="owner"]');
        await navigate(1, 2, 3, "Space", '[data-qa-navigation="owner"]');
        assert.equal(await page.evaluate(() => qaNavigationOther.view.currentMode.getScroll()), otherScroll);
        await navigate(1, 1, 2, undefined, '[data-qa-navigation="other"]');
        assert.equal(await page.locator('[data-qa-navigation="owner"] .inline-diff-navigation-status').textContent(), "Change 2 of 3");
      } finally {
        await page.evaluate(() => { delete qaNavigationOwner.view.contentEl.dataset.qaNavigation; qaNavigationOther.detach(); app.workspace.setActiveLeaf(qaNavigationOwner, { focus: true }); delete globalThis.qaNavigationOwner; delete globalThis.qaNavigationOther; });
      }
    });
    await check(`${mode}/popout arrows own their window and clean up on close`, async () => {
      await setFixture(page, fixture(2), mode); await barReady(2, mode);
      await page.evaluate(async mode => {
        globalThis.qaNavigationOwner = app.workspace.activeLeaf;
        globalThis.qaNavigationPopout = app.workspace.openPopoutLeaf();
        await qaNavigationPopout.openFile(qaNavigationOwner.view.file);
        await qaNavigationPopout.setViewState({ type: "markdown", state: { file: "Review.md", mode: mode === "reading" ? "preview" : "source", source: mode === "source" } });
      }, mode);
      try {
        let popup;
        for (let attempt = 0; attempt < 100 && !popup; attempt++) {
          for (const candidate of session.browser.contexts()[0].pages()) if (candidate !== page && await candidate.locator(".inline-diff-review-bar").count()) popup = candidate;
          if (!popup) await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(popup); await popup.bringToFront();
        await navigate(1, 1, 2, undefined, ".workspace-leaf", popup);
        await navigate(1, 2, 2, "Space", ".workspace-leaf", popup);
        assert.equal(await page.locator(".inline-diff-navigation-status").textContent(), "");
      } finally {
        await page.evaluate(() => { qaNavigationPopout.detach(); app.workspace.setActiveLeaf(qaNavigationOwner, { focus: true }); delete globalThis.qaNavigationOwner; delete globalThis.qaNavigationPopout; });
        await page.bringToFront();
      }
      await page.waitForFunction(() => app.plugins.plugins["inline-diff"].reviewBars.bars.size === app.workspace.getLeavesOfType("markdown").length);
    });
  }
  assert.deepEqual(errors, [], "plugin console errors");
} catch (error) {
  await page.screenshot({ path: path.resolve(".qa", "navigation-failure.png") });
  await fs.writeFile(path.resolve(".qa", "navigation-failure-state.json"), JSON.stringify(await page.evaluate(() => {
    const view = app.workspace.activeLeaf.view, bar = view.contentEl.querySelector(".inline-diff-review-bar");
    return { mode: view.getMode(), scroll: view.currentMode.getScroll(), bar: bar?.outerHTML, notices: [...document.querySelectorAll(".notice")].map(element => element.textContent), navigators: [...app.plugins.plugins["inline-diff"].reviewBars.bars.values()].map(bar => ({ busy: bar.navigator.busy, message: bar.navigator.message, previous: bar.navigator.previous, mode: bar.navigator.mode })), targets: [...view.contentEl.querySelectorAll(".inline-diff-review,.inline-diff-navigation-target")].map(element => ({ id: element.dataset.inlineDiffGroup, rect: element.getBoundingClientRect().toJSON() })) };
  }), null, 2));
  throw error;
} finally {
  await fs.writeFile(path.resolve(".qa", "navigation-report.json"), JSON.stringify({ date: new Date().toISOString(), artifacts: session.artifacts, passed, errors }, null, 2));
  console.log(JSON.stringify({ passed: passed.length, errors }));
  await session.close();
}
