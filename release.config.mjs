export default {
  branches: ["main"],
  // Obsidian requires the tag to exactly match the manifest version.
  tagFormat: "${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", { preset: "conventionalcommits" }],
    ["@semantic-release/release-notes-generator", { preset: "conventionalcommits" }],
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    ["@semantic-release/exec", {
      prepareCmd: "node scripts/prepare-release.mjs ${nextRelease.version} && env -u OBSIDIAN_PLUGIN_DIR -u OBSIDIAN_VAULT_DIR npm run build",
    }],
    ["@semantic-release/git", {
      assets: ["CHANGELOG.md", "package.json", "package-lock.json", "manifest.json", "versions.json"],
      message: "chore: release ${nextRelease.version} [skip ci]",
    }],
    ["@semantic-release/github", {
      assets: ["main.js", "manifest.json", "styles.css"],
      successCommentCondition: false,
      failCommentCondition: false,
      releasedLabels: false,
    }],
  ],
};
