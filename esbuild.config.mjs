import esbuild from "esbuild";
import fs from "node:fs";
import { externalModules } from "./scripts/build-externals.mjs";
import { artifactFiles, deployArtifacts, deploymentPlugin } from "./scripts/deploy.mjs";

const production = process.argv[2] === "production";
const root = import.meta.dirname;
const context = await esbuild.context({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs", target: "es2020",
  outfile: "main.js", sourcemap: production ? false : "inline", minify: production,
  external: externalModules, plugins: [deploymentPlugin(root)],
  banner: { js: "/* Generated bundle. Source: https://github.com/deepal/obsidian-inline-diff\n" + fs.readFileSync("THIRD_PARTY_NOTICES.md", "utf8") + "\n*/" },
});
if (production) {
  try { await context.rebuild(); } finally { await context.dispose(); }
} else {
  await context.watch();
  for (const file of artifactFiles.filter(file => file !== "main.js")) {
    fs.watchFile(file, { interval: 300 }, () => {
      try { deployArtifacts(root, process.env, [file]); }
      catch (error) { console.error("[deploy] failed:", error); }
    });
  }
}
