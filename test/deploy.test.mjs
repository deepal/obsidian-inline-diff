import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { artifactFiles, deploymentDirectories, deploymentPlugin, deployArtifacts } from "../scripts/deploy.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "inline-diff-deploy-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source"), vault = path.join(root, "vault");
  fs.mkdirSync(source); fs.mkdirSync(vault);
  fs.writeFileSync(path.join(source, "manifest.json"), JSON.stringify({ id: "inline-diff", version: "0.1.0" }));
  fs.writeFileSync(path.join(source, "main.js"), "new bundle");
  fs.writeFileSync(path.join(source, "styles.css"), ".test { color: red; }");
  return { root, source, vault, canonical: path.join(vault, ".obsidian/plugins/inline-diff") };
}

test("no deployment target has no side effects", t => {
  const f = fixture(t);
  assert.deepEqual(deployArtifacts(f.source, {}), []);
  assert.deepEqual(fs.readdirSync(f.vault), []);
});
test("explicit plugin folder takes precedence and settings are preserved", t => {
  const f = fixture(t), target = path.join(f.root, "explicit");
  fs.mkdirSync(target); fs.writeFileSync(path.join(target, "data.json"), "private settings");
  assert.deepEqual(deployArtifacts(f.source, { OBSIDIAN_VAULT_DIR: f.vault, OBSIDIAN_PLUGIN_DIR: target }), [target]);
  assert.equal(fs.readFileSync(path.join(target, "data.json"), "utf8"), "private settings");
  assert.deepEqual(fs.readdirSync(target).sort(), [...artifactFiles, "data.json"].sort());
  assert.equal(fs.existsSync(f.canonical), false);
});
test("discover all existing matching manifest IDs without touching other plugins", t => {
  const f = fixture(t), root = path.join(f.vault, ".obsidian/plugins");
  for (const [folder, id] of [["renamed-one", "inline-diff"], ["renamed-two", "inline-diff"], ["other", "other"]]) {
    const dir = path.join(root, folder); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id }));
    fs.writeFileSync(path.join(dir, "main.js"), "old");
  }
  assert.equal(deployArtifacts(f.source, { OBSIDIAN_VAULT_DIR: f.vault }).length, 2);
  for (const name of ["renamed-one", "renamed-two"]) assert.equal(fs.readFileSync(path.join(root, name, "main.js"), "utf8"), "new bundle");
  assert.equal(fs.readFileSync(path.join(root, "other/main.js"), "utf8"), "old");
});
test("new installations use the canonical manifest ID folder", t => {
  const f = fixture(t);
  assert.deepEqual(deploymentDirectories({ id: "inline-diff" }, { OBSIDIAN_VAULT_DIR: f.vault }), [f.canonical]);
  deployArtifacts(f.source, { OBSIDIAN_VAULT_DIR: f.vault });
  assert.equal(fs.readFileSync(path.join(f.canonical, "main.js"), "utf8"), "new bundle");
});
test("static file updates do not replace JavaScript or settings", t => {
  const f = fixture(t), env = { OBSIDIAN_VAULT_DIR: f.vault };
  deployArtifacts(f.source, env);
  fs.writeFileSync(path.join(f.canonical, "main.js"), "last successful build");
  fs.writeFileSync(path.join(f.source, "styles.css"), ".new {}" );
  deployArtifacts(f.source, env, ["styles.css"]);
  assert.equal(fs.readFileSync(path.join(f.canonical, "styles.css"), "utf8"), ".new {}");
  assert.equal(fs.readFileSync(path.join(f.canonical, "main.js"), "utf8"), "last successful build");
});
test("failed builds do not deploy and explicit copy failures fail the build", async t => {
  const f = fixture(t);
  await assert.rejects(build({ stdin: { contents: "invalid syntax )" }, write: false, logLevel: "silent", plugins: [deploymentPlugin(f.source, { OBSIDIAN_VAULT_DIR: f.vault })] }));
  assert.equal(fs.existsSync(f.canonical), false);
  const notADirectory = path.join(f.root, "file"); fs.writeFileSync(notADirectory, "sentinel");
  await assert.rejects(build({ stdin: { contents: "export const valid = true" }, write: false, logLevel: "silent", plugins: [deploymentPlugin(f.source, { OBSIDIAN_PLUGIN_DIR: notADirectory })] }));
  assert.equal(fs.readFileSync(notADirectory, "utf8"), "sentinel");
});
test("missing assets are detected before changing installed files", t => {
  const f = fixture(t), env = { OBSIDIAN_VAULT_DIR: f.vault };
  deployArtifacts(f.source, env);
  fs.writeFileSync(path.join(f.source, "main.js"), "do not deploy this");
  fs.unlinkSync(path.join(f.source, "styles.css"));
  assert.throws(() => deployArtifacts(f.source, env));
  assert.equal(fs.readFileSync(path.join(f.canonical, "main.js"), "utf8"), "new bundle");
});

test("real watch mode copies static changes and retains the last successful JavaScript after errors", async t => {
  const f = fixture(t), project = path.resolve(import.meta.dirname, "..");
  fs.mkdirSync(path.join(f.source, "src")); fs.mkdirSync(path.join(f.source, "scripts"));
  fs.writeFileSync(path.join(f.source, "src/main.ts"), "export const value = 'watch-success';");
  for (const file of ["esbuild.config.mjs", "THIRD_PARTY_NOTICES.md"]) fs.copyFileSync(path.join(project, file), path.join(f.source, file));
  for (const file of ["deploy.mjs", "build-externals.mjs"]) fs.copyFileSync(path.join(project, "scripts", file), path.join(f.source, "scripts", file));
  fs.symlinkSync(path.join(project, "node_modules"), path.join(f.source, "node_modules"), "dir");
  const env = { ...process.env, OBSIDIAN_VAULT_DIR: f.vault }; delete env.OBSIDIAN_PLUGIN_DIR;
  const child = spawn(process.execPath, ["esbuild.config.mjs"], { cwd: f.source, env, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", data => { stderr += data; });
  t.after(async () => { if (child.exitCode === null) { const exited = new Promise(resolve => child.once("exit", resolve)); child.kill(); await exited; } });
  const until = async predicate => {
    for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
    throw Error(`Watch condition timed out: ${stderr}`);
  };
  const read = file => { try { return fs.readFileSync(path.join(f.canonical, file), "utf8"); } catch { return ""; } };
  await until(() => read("main.js").includes("watch-success"));
  const successful = read("main.js");
  fs.writeFileSync(path.join(f.source, "styles.css"), ".watch-update {}\n");
  await until(() => read("styles.css") === ".watch-update {}\n");
  fs.writeFileSync(path.join(f.source, "src/main.ts"), "invalid syntax )");
  await until(() => stderr.includes("ERROR"));
  assert.equal(read("main.js"), successful);
  fs.writeFileSync(path.join(f.source, "manifest.json"), JSON.stringify({ id: "inline-diff", version: "0.1.1" }));
  await until(() => read("manifest.json").includes("0.1.1"));
  assert.equal(read("main.js"), successful);
});
