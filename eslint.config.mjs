import obsidianmd from "eslint-plugin-obsidianmd";
export default [
  ...obsidianmd.configs.recommended,
  { files: ["src/**/*.ts"], languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  {
    files: ["src/overlay.ts", "src/render.ts", "src/unified.ts", "src/presentation.ts"],
    // Native factories select the owning document explicitly. Obsidian's global
    // createEl/createDiv helpers have no typed target-document argument.
    rules: { "obsidianmd/prefer-create-el": "off" },
  },
];
