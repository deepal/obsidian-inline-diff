import { builtinModules } from "node:module";
export const externalModules = ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules, "node:*"];
