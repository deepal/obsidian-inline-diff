import { Component, MarkdownRenderChild, MarkdownView, type MarkdownPostProcessorContext, type MarkdownSectionInformation } from "obsidian";
import { lineOffsets, parseNote, reviewGroups } from "./model";
import { Comparison } from "./render";
import type InlineDiffPlugin from "./main";

interface Section { element: HTMLElement; info: () => MarkdownSectionInformation | null }
interface ReadingState {
  root: HTMLElement;
  sections: Map<HTMLElement, Section>;
  comparisons: Comparison[];
  hidden: Set<HTMLElement>;
  hosts: Set<HTMLElement>;
  frame: number | null;
  renderedSource: string;
  sourcePath: string;
  observer: MutationObserver;
  diagnostics: HTMLElement[];
}

export class ReadingCoordinator extends Component {
  private states = new Map<HTMLElement, ReadingState>();
  private stopped = false;
  constructor(private plugin: InlineDiffPlugin) { super(); }

  handle = (element: HTMLElement, context: MarkdownPostProcessorContext): void => {
    if (this.stopped || element.closest(".inline-diff-review")) return;
    const info = context.getSectionInfo(element);
    if (!info) return;
    const child = new MarkdownRenderChild(element);
    let frame: number | null = null;
    let state: ReadingState | undefined;
    child.onload = () => {
      frame = element.win.requestAnimationFrame(() => {
        frame = null;
        if (this.stopped || !element.isConnected || element.closest(".inline-diff-review")) return;
        const root = element.closest<HTMLElement>(".markdown-embed-content") ?? element.closest<HTMLElement>(".markdown-reading-view .markdown-preview-view");
        if (!root) return;
        state = this.states.get(root);
        if (!state) {
          const currentRoot = root;
          const observer = new root.ownerDocument.defaultView!.MutationObserver(records => {
            if (records.some(record => !(record.target as Element).closest?.(".inline-diff-review"))) {
              const current = this.states.get(currentRoot);
              if (current) this.schedule(current);
            }
          });
          state = { root, sections: new Map(), comparisons: [], hidden: new Set(), hosts: new Set(), frame: null, renderedSource: "", sourcePath: context.sourcePath, observer, diagnostics: [] };
          this.states.set(root, state);
          observer.observe(root, { childList: true, subtree: true });
        }
        const fresh = context.getSectionInfo(element);
        if (!fresh) return;
        state.sections.set(element, { element, info: () => context.getSectionInfo(element) });
        this.schedule(state);
      });
    };
    child.onunload = () => {
      if (frame !== null) element.win.cancelAnimationFrame(frame);
      if (!state) return;
      state.sections.delete(element);
      const current = state;
      queueMicrotask(() => {
        if (!current.root.isConnected) this.dispose(current);
        else this.schedule(current);
      });
    };
    context.addChild(child);
  };

  refresh(): void {
    for (const state of this.states.values()) { state.renderedSource = ""; this.schedule(state); }
  }

  private schedule(state: ReadingState): void {
    if (this.stopped || state.frame !== null) return;
    state.frame = state.root.win.requestAnimationFrame(() => { state.frame = null; this.draw(state); });
  }

  private draw(state: ReadingState): void {
    if (this.stopped || !state.root.isConnected) { this.dispose(state); return; }
    const sections = [...state.sections.values()].filter(section => section.element.isConnected).flatMap(section => {
      const info = section.info();
      return info ? [{ element: section.element, ...info, text: info.text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") }] : [];
    });
    const embedded = state.root.matches(".markdown-embed-content");
    const owner = this.plugin.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view)
      .find(view => view instanceof MarkdownView && (!embedded || view.file?.path === state.sourcePath) && view.containerEl.contains(state.root));
    if (!embedded && owner instanceof MarkdownView && owner.file) state.sourcePath = owner.file.path;
    const source = owner instanceof MarkdownView ? owner.getViewData().replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") : sections[sections.length - 1]?.text;
    if (source === undefined) return;
    if (state.renderedSource !== source) this.clearComparisons(state);
    const note = parseNote(source);
    const offsets = lineOffsets(source);
    for (const group of reviewGroups(note)) {
      const relevant = sections.filter(section => {
        if (section.text !== source) return false;
        const start = offsets[section.lineStart] ?? source.length;
        const end = offsets[section.lineEnd + 1] ?? source.length;
        return start < group.to && end > group.from;
      });
      const roots = relevant.filter(section => !relevant.some(other => other !== section && other.element.contains(section.element)));
      const first = roots.sort((a, b) => a.lineStart - b.lineStart)[0];
      if (!first) continue;
      let comparison = state.comparisons.find(comparison => comparison.group.id === group.id);
      if (!comparison) {
        comparison = new Comparison(this.plugin.app, state.root.ownerDocument, this.plugin, note, group, state.sourcePath, null, this.plugin.settings);
        this.addChild(comparison); state.comparisons.push(comparison);
      }
      // The native preview renderer owns section siblings and may discard an
      // injected sibling during virtualization. Postprocessors own section bodies.
      if (comparison.element.parentElement !== first.element) first.element.prepend(comparison.element);
      first.element.classList.add("inline-diff-host"); state.hosts.add(first.element);
      for (const section of roots) {
        if (section === first) continue;
        section.element.classList.add("inline-diff-hidden"); state.hidden.add(section.element);
      }
    }
    if (!state.diagnostics.length) {
      for (const diagnostic of note.diagnostics) {
        const section = sections.find(section => section.text === source && (offsets[section.lineStart] ?? source.length) <= diagnostic.from && (offsets[section.lineEnd + 1] ?? source.length) > diagnostic.from);
        if (!section) continue;
        const banner = section.element.createDiv({ cls: "inline-diff-error inline-diff-diagnostic-banner", text: diagnostic.message });
        state.diagnostics.push(banner);
      }
    }
    state.renderedSource = source;
  }

  private clearComparisons(state: ReadingState): void {
    for (const comparison of state.comparisons) { comparison.element.remove(); this.removeChild(comparison); }
    state.comparisons = [];
    for (const element of state.hidden) element.classList.remove("inline-diff-hidden");
    state.hidden.clear();
    for (const element of state.hosts) element.classList.remove("inline-diff-host");
    state.hosts.clear();
    for (const diagnostic of state.diagnostics) diagnostic.remove();
    state.diagnostics = [];
  }

  private dispose(state: ReadingState): void {
    if (state.frame !== null) state.root.win.cancelAnimationFrame(state.frame);
    state.observer.disconnect(); this.clearComparisons(state); state.sections.clear(); this.states.delete(state.root);
  }

  onunload(): void {
    this.stopped = true;
    for (const state of this.states.values()) this.dispose(state);
  }
}
