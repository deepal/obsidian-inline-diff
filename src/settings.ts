import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import type InlineDiffPlugin from "./main";

const colourDefaults = { additionText: "", additionBackground: "", deletionText: "", deletionBackground: "" };
type DiffColours = typeof colourDefaults;
const colourKeys = Object.keys(colourDefaults) as (keyof DiffColours)[];

export interface DiffSettings extends DiffColours {
  showExplorerBadges: boolean;
}
export const defaults: DiffSettings = { ...colourDefaults, showExplorerBadges: true };

export function normalizeSettings(value: unknown): DiffSettings {
  const settings = { ...defaults };
  if (!value || typeof value !== "object") return settings;
  const saved = value as Record<string, unknown>;
  if (typeof saved.showExplorerBadges === "boolean") settings.showExplorerBadges = saved.showExplorerBadges;
  for (const key of colourKeys) {
    const candidate = saved[key];
    // A small portable colour grammar; never inject arbitrary CSS from settings.
    if (typeof candidate === "string" && /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i.test(candidate)) settings[key] = candidate;
  }
  return settings;
}

export function applyColours(el: HTMLElement, settings: DiffColours): void {
  for (const key of colourKeys) {
    const property = `--inline-diff-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}`;
    if (settings[key]) el.style.setProperty(property, settings[key]);
    else el.style.removeProperty(property);
  }
}

export class DiffSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: InlineDiffPlugin) { super(app, plugin); }
  getSettingDefinitions(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem[] = [{
      name: "Show pending changes in File Explorer",
      desc: "Mark notes that have changes to review.",
      render: setting => {
        setting.addToggle(toggle => toggle.setValue(this.plugin.settings.showExplorerBadges).onChange(value => this.plugin.setExplorerBadges(value)));
      },
    }];
    for (const [key, name] of [
      ["additionText", "Addition text colour"], ["additionBackground", "Addition background colour"],
      ["deletionText", "Deletion text colour"], ["deletionBackground", "Deletion background colour"],
    ] as const) {
      items.push({ name, desc: "Use a hex, RGB, or HSL colour, or leave empty for the theme default.", render: setting => {
        setting.addText(text => text.setPlaceholder("Theme default").setValue(this.plugin.settings[key]).onChange(async value => {
          const normalized = normalizeSettings({ ...this.plugin.settings, [key]: value.trim() });
          if (value.trim() && !normalized[key]) return;
          this.plugin.settings = normalized;
          await this.plugin.saveSettings();
        }));
      } });
    }
    items.push({ name: "Reset colours", desc: "Restore theme-aware defaults.", render: setting => {
      setting.addButton(button => button.setButtonText("Reset").onClick(async () => {
        this.plugin.settings = { ...this.plugin.settings, ...colourDefaults };
        await this.plugin.saveSettings(); this.update();
      }));
    } });
    return items;
  }
}
