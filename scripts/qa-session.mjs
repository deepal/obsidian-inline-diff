import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { deployArtifacts } from "./deploy.mjs";

const project = path.resolve(import.meta.dirname, "..");
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function startSession() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inline-diff-qa-"));
  const vault = path.join(root, `Inline Diff QA ${path.basename(root).slice(-6)}`);
  const profile = path.join(root, "profile");
  const token = crypto.randomUUID();
  await fs.mkdir(path.join(vault, ".obsidian"), { recursive: true });
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(path.join(vault, ".inline-diff-qa.json"), JSON.stringify({ token, disposable: true }));
  await fs.writeFile(path.join(profile, "obsidian.json"), JSON.stringify({ vaults: { [crypto.randomBytes(8).toString("hex")]: { path: vault, ts: Date.now(), open: true } } }));
  await fs.writeFile(path.join(vault, ".obsidian", "app.json"), JSON.stringify({ livePreview: true, safeMode: false, readableLineLength: true, showInlineTitle: false }));
  await fs.writeFile(path.join(vault, ".obsidian", "community-plugins.json"), '["inline-diff"]');
  await fs.writeFile(path.join(vault, "Review.md"), "Intro.\n\nA {~~old~>new~~} sentence.\n\nTail.\n");
  await fs.writeFile(path.join(vault, "Target.md"), "# Section\n\nTarget content. ^sample\n\n# Other\n\nOther section. ^other\n");
  await fs.writeFile(path.join(vault, "Other.md"), "# Section\n\nOther content. ^sample\n\n# Other\n\nAnother section. ^other\n");
  await fs.writeFile(path.join(vault, "pixel.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxkAAAAASUVORK5CYII=", "base64"));
  const wav = Buffer.alloc(44 + 800); wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(800, 40);
  await fs.writeFile(path.join(vault, "tone.wav"), wav);
  for (const name of ["sample", "other"]) {
    await fs.writeFile(path.join(vault, `${name}.canvas`), JSON.stringify({ nodes: [{ id: "n", type: "text", text: name, x: 0, y: 0, width: 100, height: 60 }], edges: [] }));
    await fs.writeFile(path.join(vault, `${name}.base`), 'filters: \'file.ext == "md"\'\nviews:\n  - type: table\n    name: Results\n');
  }
  // Tiny deterministic two-page PDF, generated without external fixtures.
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 5 0 R >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 5 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await fs.writeFile(path.join(vault, "sample.pdf"), pdf);
  deployArtifacts(project, { OBSIDIAN_VAULT_DIR: vault });
  const child = spawn(process.env.OBSIDIAN_EXECUTABLE || "/Applications/Obsidian.app/Contents/MacOS/Obsidian", [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", data => { stderr += data.toString(); });
  try {
  let port;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { port = (await fs.readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; } catch { /* application startup */ }
    if (child.exitCode !== null) throw new Error(`Disposable Obsidian exited: ${stderr}`);
    await delay(100);
  }
  if (!port) { child.kill(); throw new Error(`No disposable debugger: ${stderr}`); }
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page;
  for (let attempt = 0; attempt < 150; attempt++) {
    for (const candidate of browser.contexts()[0].pages()) {
      if (await candidate.evaluate(() => !!globalThis.app?.workspace?.layoutReady).catch(() => false)) { page = candidate; break; }
    }
    if (page) break;
    await delay(100);
  }
  if (!page) { await browser.close(); child.kill(); throw new Error(`Disposable vault did not open: ${stderr}`); }
  page.setDefaultTimeout(15000);
  const actual = await page.evaluate(() => app.vault.adapter.getBasePath());
  if (path.resolve(actual) !== path.resolve(vault) || JSON.parse(await fs.readFile(path.join(actual, ".inline-diff-qa.json"), "utf8")).token !== token) {
    await browser.close(); child.kill(); throw new Error("Refusing to operate on a non-disposable vault.");
  }
  await fs.mkdir(path.join(project, ".qa"), { recursive: true });
  await fs.writeFile(path.join(project, ".qa", "session.json"), JSON.stringify({ root, vault, profile, port, pid: child.pid, token }, null, 2));
  await page.waitForFunction(() => !!app.commands.commands["inline-diff:accept-all-changes"] || [...document.querySelectorAll(".modal button")].some(button => button.textContent === "Trust author and enable plugins"));
  const trust = page.getByRole("button", { name: "Trust author and enable plugins", exact: true });
  if (await trust.count()) await trust.click();
  // Trusting the vault starts native plugin loading. Do not race a second
  // enablePlugin call against that load and accidentally instantiate it twice.
  await page.waitForFunction(() => !!app.commands.commands["inline-diff:accept-all-changes"]);
  await page.evaluate(() => app.setting?.close());
  await page.evaluate(async () => {
    if (!app.plugins.plugins["inline-diff"]) throw new Error("The disposable plugin did not load.");
    await app.workspace.getLeaf().openFile(app.vault.getAbstractFileByPath("Review.md"));
    const view = app.workspace.activeLeaf.view;
    view.editor.setCursor(view.editor.lastLine(), 0);
  });
  const video = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 16; canvas.height = 16;
    const context = canvas.getContext("2d"); context.fillStyle = "#77aaee"; context.fillRect(0, 0, 16, 16);
    const stream = canvas.captureStream(10), recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" }), chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const finished = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start(); await new Promise(resolve => setTimeout(resolve, 150)); recorder.stop(); await finished;
    stream.getTracks().forEach(track => track.stop());
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  await fs.writeFile(path.join(vault, "clip.webm"), Buffer.from(video));
  return { root, vault, profile, port, child, browser, page, async close() { await browser.close(); child.kill(); } };
  } catch (error) { child.kill(); throw error; }
}
