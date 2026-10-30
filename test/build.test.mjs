import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";
import { externalModules } from "../scripts/build-externals.mjs";

test("host modules and all forms of Node built-ins remain external", async () => {
  const imports = ["obsidian", "electron", "@codemirror/state", "@codemirror/view", "@lezer/common", "fs", "fs/promises", "node:fs", "node:fs/promises", "node:sqlite"];
  const result = await build({ stdin: { contents: imports.map((name, i) => `export {default as module${i}} from ${JSON.stringify(name)};`).join("\n") }, bundle: true, format: "cjs", platform: "browser", write: false, metafile: true, external: externalModules });
  const output = Object.values(result.metafile.outputs)[0];
  assert.deepEqual(output.imports.map(({ path }) => path).sort(), [...imports].sort());
  assert.ok(output.imports.every(({ external }) => external));
});
test("package metadata and compatibility history agree", () => {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
  const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
  assert.equal(manifest.version, pkg.version); assert.equal(manifest.version, lock.version);
  assert.equal(manifest.version, lock.packages[""].version);
  assert.equal(versions[manifest.version], manifest.minAppVersion);
  assert.equal(manifest.isDesktopOnly, true);
  assert.ok(fs.readFileSync("THIRD_PARTY_NOTICES.md", "utf8").includes("Kevin Decker"));
});
