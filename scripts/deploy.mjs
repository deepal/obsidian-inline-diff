import fs from "node:fs";
import path from "node:path";

export const artifactFiles = ["main.js", "manifest.json", "styles.css"];

export function deploymentDirectories(manifest, env = process.env) {
  if (env.OBSIDIAN_PLUGIN_DIR) return [path.resolve(env.OBSIDIAN_PLUGIN_DIR)];
  if (!env.OBSIDIAN_VAULT_DIR) return [];
  const root = path.join(env.OBSIDIAN_VAULT_DIR, ".obsidian", "plugins");
  const matches = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name))
    .filter(dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).id === manifest.id; } catch { return false; } }) : [];
  return matches.length ? matches : [path.join(root, manifest.id)];
}

export function deployArtifacts(root, env = process.env, files = artifactFiles) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const destinations = deploymentDirectories(manifest, env);
  // Read all selected assets before changing an installation.
  const assets = destinations.length ? files.map(file => [file, fs.readFileSync(path.join(root, file))]) : [];
  for (const dir of destinations) {
    fs.mkdirSync(dir, { recursive: true });
    for (const [file, bytes] of assets) {
      const target = path.join(dir, file);
      const temporary = `${target}.inline-diff-tmp`;
      try { fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, target); }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
  }
  return destinations;
}

export function deploymentPlugin(root, env = process.env) {
  return { name: "deploy-to-vault", setup(build) {
    build.onEnd(({ errors }) => {
      if (errors.length) return;
      const destinations = deployArtifacts(root, env);
      if (destinations.length) console.log(`[deploy] ${destinations.join(", ")}`);
    });
  } };
}
