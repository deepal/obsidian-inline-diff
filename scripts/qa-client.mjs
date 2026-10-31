import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { artifactFiles, deployArtifacts } from "./deploy.mjs";
import { startSession } from "./qa-session.mjs";

export async function connectSession() {
  if (!process.env.QA_ATTACH) {
    const session = await startSession();
    session.artifacts = await verifyArtifacts(session);
    return session;
  }
  const data = JSON.parse(await fs.readFile(path.resolve(".qa/session.json"), "utf8"));
  const sentinel = JSON.parse(await fs.readFile(path.join(data.vault, ".inline-diff-qa.json"), "utf8"));
  if (!sentinel.disposable || sentinel.token !== data.token || !path.basename(data.vault).startsWith("Inline Diff QA ")) throw Error("Refusing a non-disposable session.");
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${data.port}`);
  const page = browser.contexts()[0].pages().find(page => page.url().startsWith("app://obsidian.md/"));
  if (!page || await page.evaluate(() => app.vault.adapter.getBasePath()) !== data.vault) { await browser.close(); throw Error("Wrong debugger target."); }
  page.setDefaultTimeout(15000);
  deployArtifacts(process.cwd(), { OBSIDIAN_VAULT_DIR: data.vault });
  await page.evaluate(async () => {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) if (leaf.view.containerEl.ownerDocument !== document) leaf.detach();
    const main = app.workspace.getLeavesOfType("markdown").find(leaf => leaf.view.containerEl.ownerDocument === document);
    if (main) app.workspace.setActiveLeaf(main, { focus: true });
    await app.plugins.disablePlugin("inline-diff"); await app.plugins.enablePlugin("inline-diff");
  });
  const session = { ...data, browser, page, close: () => browser.close() };
  session.artifacts = await verifyArtifacts(session);
  return session;
}

async function verifyArtifacts(session) {
  const identity = await session.page.evaluate(() => ({ dir: app.plugins.manifests["inline-diff"].dir, build: app.plugins.plugins["inline-diff"].buildIdentity }));
  const target = path.resolve(session.vault, identity.dir);
  if (!target.startsWith(path.resolve(session.vault) + path.sep)) throw Error("Installation escaped the disposable vault.");
  const hashes = {};
  for (const file of artifactFiles) {
    const expected = await fs.readFile(path.resolve(file)), actual = await fs.readFile(path.join(target, file));
    if (!expected.equals(actual)) throw Error(`Installed artifact differs: ${file}`);
    hashes[file] = createHash("sha256").update(actual).digest("hex");
  }
  return { identity: identity.build, sha256: hashes };
}

export async function installOracle(session) {
  const dir = path.join(session.vault, ".obsidian/plugins/inline-diff-qa-oracle");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ id: "inline-diff-qa-oracle", name: "Inline Diff QA Oracle", version: "0.0.0", minAppVersion: "1.14.5", isDesktopOnly: true, description: "Disposable test oracle.", author: "QA" }));
  await fs.writeFile(path.join(dir, "main.js"), `
const o = require('obsidian');
module.exports = class extends o.Plugin {
 onload() {
  this.addCommand({id:'review-shortcut',name:'Test review shortcut',hotkeys:[{modifiers:['Mod','Alt'],key:'Y'}],callback:()=>app.commands.executeCommandById('inline-diff:accept-all-changes')});
  document.querySelectorAll('.inline-diff-qa-oracle').forEach(root=>root.remove());
  globalThis.inlineDiffQa = {
   version: o.apiVersion,
   frontmatterInfo(text) { return o.getFrontMatterInfo(text); },
   frontmatterRule() { return o.getFrontMatterInfo.toString(); },
   async save(view) {
    await view.save();
    for(let attempt=0;attempt<300;attempt++){
     if(!view.saving&&!view.saveAgain)return;
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    throw Error('Disposable fixture save did not settle.');
   },
   inspect(view) {
    const cm=view.editor.cm, info=cm.state.field(o.editorInfoField,false);
    return {viewNative:view instanceof o.MarkdownView,infoType:info?.constructor.name,infoSame:info===view,live:cm.state.field(o.editorLivePreviewField,false),cmNative:cm instanceof require('@codemirror/view').EditorView,selection:cm.state.selection.main.anchor,length:cm.state.doc.length,html:view.contentEl.innerHTML.slice(0,700)};
   },
   observe(view) {
    const s=require('@codemirror/state'), commands=require('@codemirror/commands');
    globalThis.inlineDiffQa.transactions=[];
    view.editor.cm.dispatch({effects:s.StateEffect.appendConfig.of(s.EditorState.transactionExtender.of(tr=>{
     if(tr.docChanged)globalThis.inlineDiffQa.transactions.push({source:tr.newDoc.toString(),event:tr.annotation(s.Transaction.userEvent),history:tr.annotation(s.Transaction.addToHistory),isolation:tr.annotation(commands.isolateHistory),annotations:tr.annotations.map(a=>({id:a.type.id,value:typeof a.value==='object'?'object':a.value}))});
     return null;
    }))});
   },
   makeReadOnly(view) {
    const s=require('@codemirror/state');
    view.editor.cm.dispatch({effects:s.StateEffect.appendConfig.of(s.EditorState.readOnly.of(true))});
   },
   async render(markdown) {
    const root = document.createElement('div');
    root.className = 'markdown-rendered inline-diff-review inline-diff-qa-oracle';
    root.style.cssText = 'position:fixed;left:-10000px;width:600px;top:0';
    document.body.append(root);const owner = new o.Component();owner.load();
    await o.MarkdownRenderer.render(app, markdown, root, 'Review.md', owner);
    return { root, dispose() { owner.unload();root.remove(); } };
   },
   undo(view) { return view.editor.undo(); },
   redo(view) { return view.editor.redo(); },
  };
 }
 onunload() { delete globalThis.inlineDiffQa; }
};`);
  await session.page.evaluate(async () => {
    await app.plugins.loadManifests();
    await app.plugins.disablePlugin("inline-diff-qa-oracle");
    await app.plugins.enablePlugin("inline-diff-qa-oracle");
    if (!globalThis.inlineDiffQa) throw Error("Native rendering oracle failed to load.");
  });
}

export async function setFixture(page, source, mode) {
  await page.evaluate(async ({ source, mode }) => {
    const leaf = app.workspace.activeLeaf;
    if (leaf.view.getViewType() === "markdown") await inlineDiffQa.save(leaf.view);
    await leaf.setViewState({ type: "empty", state: {} });
    const file = app.vault.getAbstractFileByPath("Review.md");
    await app.vault.modify(file, source);
    await leaf.openFile(file);
    await leaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: "source", source: mode === "source" } });
  }, { source, mode });
  await page.waitForFunction(source => {
    const view = app.workspace.activeLeaf.view;
    return view.file?.path === "Review.md" && view.editor.getValue() === source && view.data === source;
  }, source);
  await page.evaluate(async mode => {
    const leaf = app.workspace.activeLeaf, view = leaf.view;
    view.editor.setCursor(view.editor.lastLine(), 0);
    view.editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, true);
    if (mode === "reading") await leaf.setViewState({ type: "markdown", state: { file: "Review.md", mode: "preview" } });
    app.plugins.plugins["inline-diff"].overlays.get(document)?.hide();
  }, mode);
  if (mode === "reading") await page.waitForFunction(source => {
    const renderer = app.workspace.activeLeaf.view.previewMode.renderer;
    return renderer.lastText === source && !renderer.parsing && !renderer.queued && !renderer.rendered;
  }, source);
}
