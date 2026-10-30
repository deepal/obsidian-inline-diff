import { sha256 } from "@noble/hashes/sha2.js";
import { Component, type MarkdownView, type TFile } from "obsidian";
import { preserveLineEndings } from "./line-endings";
import { normalizedText, type ReviewSerialization } from "./serialization";

interface Layout { bom: boolean; endings: boolean[] }
interface Hook {
  file: TFile; source: string; lastSerialized: string;
  layouts: Map<string, Layout>;
  original: MarkdownView["getViewData"]; replacement: MarkdownView["getViewData"];
}
const key = (text: string) => [...sha256(new TextEncoder().encode(normalizedText(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
function remember(hook: Hook, text: string): void {
  hook.layouts.set(key(text), { bom: text.startsWith("\uFEFF"), endings: [...text.matchAll(/\r?\n/g)].map(match => match[0] === "\r\n") });
}
function restore(layout: Layout, text: string): string {
  let line = 0;
  return (layout.bom ? "\uFEFF" : "") + normalizedText(text).replace(/\n/g, () => layout.endings[line++] ? "\r\n" : "\n");
}

/** Preserve native history using compact format snapshots, without retaining
 * a full document copy for each review decision. */
export class FormatPreserver extends Component {
  private hooks = new Map<MarkdownView, Hook>();
  private stopped = false;

  preserve(view: MarkdownView, source: string = view.data, transition?: ReviewSerialization): void {
    const prior = this.hooks.get(view);
    if (prior?.file === view.file) {
      prior.source = transition?.after ?? source;
      remember(prior, source);
      if (transition) { remember(prior, transition.before); remember(prior, transition.after); }
      return;
    }
    if (prior) this.restore(view, prior);
    if (!view.file || (!source.includes("\r\n") && !source.startsWith("\uFEFF") && !transition?.after.includes("\r\n"))) return;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Retain the exact method identity and call it with its original receiver.
    const original = view.getViewData;
    const file = view.file;
    const active = () => !this.stopped;
    const hook: Hook = { file, source: transition?.after ?? source, lastSerialized: "", layouts: new Map(), original, replacement: original };
    remember(hook, source);
    if (transition) { remember(hook, transition.before); remember(hook, transition.after); }
    const replacement = function(this: MarkdownView): string {
      const current = original.call(this);
      if (!active() || this.file !== file) return current;
      const known = hook.layouts.get(key(current));
      if (known) return hook.lastSerialized = restore(known, current);
      const data = normalizedText(this.data);
      if (data !== normalizedText(hook.source) && data !== normalizedText(hook.lastSerialized) && !hook.layouts.has(key(this.data))) {
        hook.source = this.data; hook.layouts.clear(); remember(hook, this.data);
      }
      hook.lastSerialized = preserveLineEndings(hook.source, current);
      return hook.lastSerialized;
    };
    hook.replacement = replacement;
    this.hooks.set(view, hook);
    view.getViewData = replacement;
  }

  prune(views: MarkdownView[]): void {
    for (const [view, hook] of this.hooks) if (!views.includes(view)) this.restore(view, hook);
  }

  private restore(view: MarkdownView, hook: Hook): void {
    if (view.getViewData === hook.replacement) view.getViewData = hook.original;
    this.hooks.delete(view);
  }

  onunload(): void {
    this.stopped = true;
    for (const [view, hook] of this.hooks) this.restore(view, hook);
  }
}
