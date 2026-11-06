import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { connectSession, installOracle, setFixture } from "./qa-client.mjs";
import { deployArtifacts } from "./deploy.mjs";

const session = await connectSession();
const { page } = session;
const badgeClass = ".inline-diff-explorer-badge";
const row = file => page.locator(`.nav-file-title[data-path="${file}"]`);
const badge = file => row(file).locator(badgeClass);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (message.type() === "error" && /plugin:(?:inline-diff|ai-overview)/i.test(message.text())) errors.push(message.text());
});

async function expectBadge(file, count) {
  const args = { file, count, badgeClass };
  await page.waitForFunction(({ file, count, badgeClass }) => {
    const rows = [...document.querySelectorAll(".nav-file-title[data-path]")].filter(row => row.dataset.path === file);
    const badges = rows.flatMap(row => [...row.querySelectorAll(badgeClass)]);
    return count ? badges.length === 1 && badges[0].getAttribute("aria-label") === `${count} pending ${count === 1 ? "change" : "changes"}` : !badges.length;
  }, args).catch(async error => {
    const rows = await page.locator(".nav-file-title[data-path]").evaluateAll((rows, badgeClass) =>
      rows.map(row => [row.dataset.path, row.querySelector(badgeClass)?.getAttribute("aria-label")]), badgeClass);
    throw new Error(`Expected ${count} pending changes for ${file}. Rendered rows: ${JSON.stringify(rows)}`, { cause: error });
  });
}

async function openSettings() {
  await page.evaluate(() => { app.setting.open(); app.setting.openTabById("inline-diff"); });
  const title = "Show pending changes in File Explorer";
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const candidate of session.browser.contexts()[0].pages()) {
      if (await candidate.getByText(title, { exact: true }).isVisible()) return candidate;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Inline Diff settings did not open");
}

const closeSettings = () => page.evaluate(() => app.setting.close());
async function toggleBadge() {
  const settingsPage = await openSettings();
  await settingsPage.locator(".setting-item").filter({ hasText: "Show pending changes in File Explorer" }).locator(".checkbox-container").click();
  await closeSettings();
}
const reload = () => page.evaluate(async () => {
  await app.plugins.disablePlugin("inline-diff");
  await app.plugins.enablePlugin("inline-diff");
});

try {
  await installOracle(session);
  await expectBadge("Review.md", 1);
  assert.equal(await badge("Review.md").locator("svg").count(), 1);
  await page.mouse.move(400, 100);
  await badge("Review.md").hover();
  await page.locator(".tooltip").filter({ hasText: "1 pending change" }).waitFor();

  const original = "Unopened.md";
  const closed = path.join(session.vault, original);
  await fs.writeFile(closed, "{++one++} {--two--}\n");
  await expectBadge(original, 2);
  assert.equal(await page.evaluate(() => app.workspace.getLeavesOfType("markdown").some(leaf => leaf.view.file?.path === "Unopened.md")), false);
  await fs.writeFile(closed, "`{++literal++}`\n\n{++incomplete\n");
  await page.waitForFunction(async () => (await app.vault.cachedRead(app.vault.getFileByPath("Unopened.md"))).includes("incomplete"));
  await expectBadge(original, 0);
  await fs.writeFile(closed, "{~~before~>after~~}\n");
  await expectBadge(original, 1);
  console.log("PASS unopened notes, external edits, literal markers and tooltip");

  await page.evaluate(async () => {
    await app.vault.createFolder("Folder");
    await app.vault.rename(app.vault.getFileByPath("Unopened.md"), "Folder/Moved.md");
  });
  const folder = page.locator('.nav-folder-title[data-path="Folder"]');
  const collapseIcon = folder.locator(".collapse-icon");
  if (await collapseIcon.evaluate(el => el.classList.contains("is-collapsed"))) await collapseIcon.click();
  await expectBadge("Folder/Moved.md", 1);
  await expectBadge(original, 0);
  await collapseIcon.click();
  await row("Folder/Moved.md").waitFor({ state: "detached" });
  await expectBadge("Folder/Moved.md", 0);
  assert.equal(await folder.locator(badgeClass).count(), 0);
  await collapseIcon.click();
  await expectBadge("Folder/Moved.md", 1);
  await page.evaluate(() => app.vault.rename(app.vault.getFolderByPath("Folder"), "Renamed"));
  await expectBadge("Renamed/Moved.md", 1);
  await fs.unlink(path.join(session.vault, "Renamed/Moved.md"));
  await row("Renamed/Moved.md").waitFor({ state: "detached" });
  console.log("PASS moves, folder renames, tree redraws and deletion");

  await page.evaluate(() => {
    const leaf = app.workspace.getLeavesOfType("markdown").find(leaf => leaf.view.file?.path === "Review.md");
    app.workspace.setActiveLeaf(leaf, { focus: true });
  });
  const source = "A {~~before~>after~~} sentence.\n";
  for (const mode of ["source", "live"]) {
    await setFixture(page, source, mode);
    for (const decision of ["accept", "reject"]) {
      await expectBadge("Review.md", 1);
      await page.evaluate(async decision => {
        app.commands.executeCommandById(`inline-diff:${decision}-all-changes`);
        await app.plugins.plugins["inline-diff"].lastResolution;
      }, decision);
      await expectBadge("Review.md", 0);
      await page.evaluate(() => inlineDiffQa.undo(app.workspace.activeLeaf.view));
      await expectBadge("Review.md", 1);
      await page.evaluate(() => inlineDiffQa.save(app.workspace.activeLeaf.view));
    }
  }
  await setFixture(page, source, "reading");
  await expectBadge("Review.md", 1);
  console.log("PASS Source, Live Preview and Reading view, including accept, reject and undo");

  const aiOverview = process.env.QA_AI_OVERVIEW_DIR;
  if (aiOverview) {
    deployArtifacts(aiOverview, { OBSIDIAN_VAULT_DIR: session.vault });
    await page.evaluate(async () => {
      await app.plugins.loadManifests();
      await app.plugins.enablePlugin("ai-overview");
      const plugin = app.plugins.plugins["ai-overview"];
      // Use the real badge renderer with a controlled running state, without starting an agent.
      plugin.summariser.activity = () => [{ notePath: "Review.md", phase: "running" }];
      plugin.fileActivity.refresh();
      app.workspace.leftSplit.setSize(180);
    });
    const aiBadge = row("Review.md").locator(".aio-file-activity[data-aio-state=active]");
    await aiBadge.waitFor();
    const bounds = await row("Review.md").evaluate((el, badgeClass) => {
      const rect = selector => el.querySelector(selector).getBoundingClientRect().toJSON();
      return { row: el.getBoundingClientRect().toJSON(), diff: rect(badgeClass), ai: rect(".aio-file-activity"), sidebar: app.workspace.leftSplit.containerEl.getBoundingClientRect().width };
    }, badgeClass);
    assert.ok(bounds.sidebar <= 200, JSON.stringify(bounds));
    assert.ok(bounds.diff.width > 0 && bounds.ai.width > 0 && bounds.diff.right <= bounds.ai.left && bounds.ai.right <= bounds.row.right, JSON.stringify(bounds));
    await row("Target.md").click();
    await row("Review.md").locator(".nav-file-title-content").click();
    assert.equal(await page.evaluate(() => app.workspace.getActiveFile()?.path), "Review.md");
    await toggleBadge();
    await expectBadge("Review.md", 0);
    await aiBadge.waitFor();
    console.log("PASS AI Overview coexistence, narrow sidebar and row clicks");
  } else {
    await toggleBadge();
  }

  await expectBadge("Review.md", 0);
  await reload();
  assert.equal(await page.evaluate(() => app.plugins.plugins["inline-diff"].settings.showExplorerBadges), false);
  const settingsPage = await openSettings();
  await settingsPage.locator('input[placeholder="Theme default"]').first().fill("#123456");
  await page.waitForFunction(() => app.plugins.plugins["inline-diff"].settings.additionText === "#123456");
  await settingsPage.getByRole("button", { name: "Reset", exact: true }).click();
  await closeSettings();
  assert.equal(await page.evaluate(() => app.plugins.plugins["inline-diff"].settings.showExplorerBadges), false);
  assert.equal(await page.evaluate(() => app.plugins.plugins["inline-diff"].settings.additionText), "");
  await toggleBadge();
  await expectBadge("Review.md", 1);
  await page.evaluate(() => app.plugins.disablePlugin("inline-diff"));
  assert.equal(await page.locator(badgeClass).count(), 0);
  if (aiOverview) assert.equal(await row("Review.md").locator(".aio-file-activity").count(), 1);
  console.log("PASS toggle persistence, colour reset and unload cleanup");
  assert.deepEqual(errors, []);
} finally {
  await session.close();
}
