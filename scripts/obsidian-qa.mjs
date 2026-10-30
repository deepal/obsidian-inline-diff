import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { connectSession, installOracle, setFixture } from "./qa-client.mjs";
import { markdownFixtures } from "../test/fixtures/markdown.mjs";

const session = await connectSession();
const { page } = session;
const passed = [], failures = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error" && /inline.diff|plugin:inline-diff/i.test(message.text())) errors.push(message.text()); });

// Remove only plugin decorations and host-generated nonsemantic controls.
function canonical(root) {
  function walk(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    const el = node;
    if (el.matches(".inline-diff-empty,.copy-code-button,.footnote-backref,.collapse-indicator,.callout-icon,.callout-fold")) return "";
    if (el.matches(".inline-diff-changed")) return [...el.childNodes].map(walk).join("");
    if (el.matches(".pdf-embed")) return `<pdf alt=${JSON.stringify(el.getAttribute("alt"))}></pdf>`;
    if (el.matches("svg")) return `<svg>${[...el.querySelectorAll("text,foreignObject")].map(e => e.textContent).join("|")}</svg>`;
    if (el.matches(".math")) return `<math>${el.getAttribute("data-math") || el.textContent}</math>`;
    const attrs = ["href", "data-href", "data-callout", "data-src", "src", "alt", "align", "type", "width", "height", "title", "checked"].filter(name => el.hasAttribute(name)).map(name => {
      let value = el.getAttribute(name);
      if (name === "href" && el.closest(".footnotes,.footnote-ref")) value = "#footnote";
      return ` ${name}=${JSON.stringify(value)}`;
    }).join("");
    const children = [...el.childNodes].map(walk).join("");
    return `<${el.tagName.toLowerCase()}${attrs}>${children}</${el.tagName.toLowerCase()}>`;
  }
  return [...root.childNodes].map(walk).join("").replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
}

try {
  await installOracle(session);
  const selected = markdownFixtures.filter(fixture => !process.env.QA_FILTER || new RegExp(process.env.QA_FILTER).test(fixture.id));
  for (const fixture of selected) {
    for (const mode of ["source", "live", "reading"]) {
      const name = `${fixture.id}/${mode}`;
      try {
        await setFixture(page, fixture.source, mode);
        if (mode === "source") {
          await page.waitForSelector(".cm-content .inline-diff-source-mark", { timeout: 4000 });
          assert.equal(await page.locator(".markdown-source-view .inline-diff-review").count(), 0);
        } else {
          const scope = mode === "reading" ? ".markdown-reading-view" : ".markdown-source-view";
          await page.waitForFunction(({ scope, mode, source }) => {
            const valid = () => {
              const view = app.workspace.activeLeaf.view;
              if (view.contentEl.querySelectorAll(`${scope} .inline-diff-review[data-inline-diff-ready=true]`).length !== 1) return false;
              if (mode !== "reading") return true;
              const renderer = view.previewMode.renderer;
              if (renderer.parsing || renderer.queued || renderer.rendered || renderer.lastText !== source) return false;
              return [...app.plugins.plugins["inline-diff"].reading.states.values()].some(state => view.contentEl.contains(state.root) && state.renderedSource === source && state.comparisons.length === 1 && state.comparisons[0].element.isConnected);
            };
            if (!valid()) return false;
            const element = app.workspace.activeLeaf.view.contentEl.querySelector(`${scope} .inline-diff-review`);
            const stamp = mode === "reading" ? app.workspace.activeLeaf.view.previewMode.renderer.lastRender : 0;
            const prior = inlineDiffQa.readiness;
            if (prior?.element === element && prior.stamp === stamp) return ++prior.frames >= 3;
            inlineDiffQa.readiness = { element, stamp, frames: 0 }; return false;
          }, { scope, mode, source: fixture.source }, { timeout: 8000 });
          const comparison = page.locator(`${scope} .inline-diff-review`).first();
          assert.equal(await page.locator(`${scope} .inline-diff-review`).count(), 1);
          const body = text => text.replace(/^Intro\.\n\n/, "").replace(/\n\nTail\.\n$/, "").replace(/^\nTail\.\n$/, "");
          const actual = await comparison.evaluate(async (element, { before, after, canonicalSource }) => {
            const normalize = (0, eval)(`(${canonicalSource})`);
            const results = [];
            for (const [selector, markdown] of [[".inline-diff-before .inline-diff-content", before], [".inline-diff-after .inline-diff-content", after]]) {
              const oracle = await inlineDiffQa.render(markdown);
              results.push({ actual: normalize(element.querySelector(selector)), expected: normalize(oracle.root) });
              oracle.dispose();
            }
            return results;
          }, { before: body(fixture.before), after: body(fixture.after), canonicalSource: canonical.toString() });
          for (const [index, result] of actual.entries()) assert.equal(result.actual, result.expected, index ? "After native rendering" : "Before native rendering");
          if (mode === "reading") {
            assert.equal(await comparison.locator("[data-decision],.inline-diff-proposal-anchor,.inline-diff-source-entry[tabindex]").count(), 0);
            await comparison.hover();
            assert.equal(await page.locator(".inline-diff-toolbar:visible").count(), 0);
            for (const command of ["accept-change", "reject-change", "accept-all-changes", "reject-all-changes"]) assert.equal(await page.evaluate(command => app.commands.commands[`inline-diff:${command}`].checkCallback(true), command), false);
          }
        }
        assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.getViewData()), fixture.source);
        if (mode !== "reading") {
          for (const decision of ["accept", "reject"]) {
            await setFixture(page, fixture.source, mode);
            if (mode === "live") {
              await page.waitForSelector(".markdown-source-view .inline-diff-review[data-inline-diff-ready=true]", { timeout: 8000 });
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            }
            const selector = mode === "source" ? ".cm-content .inline-diff-source-mark" : ".markdown-source-view .inline-diff-proposal-anchor";
            const target = page.locator(selector).first();
            await target.waitFor({ timeout: 4000 }); await page.mouse.move(5, 5); await target.hover();
            assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()), fixture.source, "hover preserves the fixture buffer");
            await page.locator(`.inline-diff-toolbar:visible [data-decision=${decision}]`).click({ timeout: 4000 });
            await page.evaluate(() => app.plugins.plugins["inline-diff"].lastResolution);
            const expected = decision === "accept" ? fixture.after : fixture.before;
            assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()), expected);
            await page.evaluate(async () => { await inlineDiffQa.save(app.workspace.activeLeaf.view); });
            assert.equal(await fs.readFile(path.join(session.vault, "Review.md"), "utf8"), expected);
            await page.evaluate(() => inlineDiffQa.undo(app.workspace.activeLeaf.view));
            assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()), fixture.source, "one undo restores proposal");
            await page.evaluate(() => inlineDiffQa.redo(app.workspace.activeLeaf.view));
            assert.equal(await page.evaluate(() => app.workspace.activeLeaf.view.editor.getValue()), expected, "redo restores decision");
          }
        }
        passed.push(name);
      } catch (error) {
        failures.push({ name, error: error.message });
        console.log(`FAIL ${name}: ${error.message.slice(0,600)}`);
        await page.screenshot({ path: path.resolve(".qa", "failure.png") });
        await fs.writeFile(path.resolve(".qa", "failure-state.json"), JSON.stringify(await page.evaluate(() => {
          const view = app.workspace.activeLeaf.view;
          return { data: view.data, current: view.getViewData(), source: view.editor.getValue(), states: [...app.plugins.plugins["inline-diff"].reading.states.values()].map(state => ({ source: state.renderedSource, connected: state.root.isConnected, comparisons: state.comparisons.length })) };
        }), null, 2));
        if (process.env.QA_FAIL_FAST !== "0") throw error;
      }
    }
    if (passed.length % 30 === 0) console.log(`PASS ${passed.length} app cases`);
  }
  assert.deepEqual(errors, [], "plugin console errors");
} finally {
  const report = { date: new Date().toISOString(), platform: process.platform, artifacts: session.artifacts, version: await page.evaluate(() => globalThis.inlineDiffQa?.version).catch(() => null), passed, failures, errors };
  await fs.writeFile(path.resolve(".qa", "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: passed.length, failures: failures.length, errors: errors.length }));
  if (process.env.QA_KEEP_OPEN) { console.log("QA_KEEP_OPEN: debugger at", session.port); await new Promise(() => {}); }
  else await session.close();
}
assert.equal(failures.length, 0);
