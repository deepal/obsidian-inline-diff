import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { Component, editorLivePreviewField, Notice, type MarkdownView } from "obsidian";
import { revealComparisons } from "./editor";
import { lineOffsets, parseNote, reviewGroups, type Proposal } from "./model";
import { normalizedText } from "./serialization";
import type { NavigationController, NavigationDirection, ReviewSnapshot } from "./status";

/** Source identity, rather than rendered text, orders even identical/shared proposals. */
export function navigationIndex(proposals: readonly Proposal[], offset: number, direction: NavigationDirection, previous: number | null): number | null {
  if (proposals.length <= 1) return null;
  if (previous !== null && previous >= 0 && previous < proposals.length) return (previous + direction + proposals.length) % proposals.length;
  if (direction > 0) {
    const index = proposals.findIndex(proposal => proposal.to > offset);
    return index < 0 ? 0 : index;
  }
  for (let index = proposals.length - 1; index >= 0; index--) if (proposals[index].from < offset) return index;
  return proposals.length - 1;
}

/** Owned by a single review bar, so listeners and pending work follow that pane. */
export class ChangeNavigator extends Component implements NavigationController {
  busy = false;
  message = "";
  private snapshot: ReviewSnapshot | null = null;
  private mode = "";
  private previous: number | null = null;
  private generation = 0;
  private stopped = false;
  private surface: HTMLElement | null = null;
  private scrollTop = 0;
  private inputHost: HTMLElement | null = null;
  private highlights: HTMLElement[] = [];
  private clearHighlight: (() => void) | null = null;
  private waits = new Set<() => void>();

  constructor(private read: () => ReviewSnapshot | null, private editorView: (view: MarkdownView) => EditorView | null, private changed: () => void) {
    super();
    this.register(() => { this.stopped = true; this.reset(); });
  }

  refresh(snapshot: ReviewSnapshot | null): void {
    const mode = snapshot ? this.viewMode(snapshot.view) : "";
    if (snapshot?.view !== this.snapshot?.view || snapshot?.file !== this.snapshot?.file || snapshot?.source !== this.snapshot?.source || mode !== this.mode || snapshot?.busy) this.reset();
    this.snapshot = snapshot; this.mode = mode;
    if (snapshot && !this.inputHost) this.bind(snapshot.view.contentEl);
  }

  go(direction: NavigationDirection): void {
    const snapshot = this.read();
    this.refresh(snapshot);
    if (this.stopped || !snapshot || snapshot.busy || this.busy || snapshot.pending <= 1) return;
    const { view } = snapshot;
    // Renderer and editor coordinates use LF text without a BOM; the snapshot
    // may retain the original disk format through FormatPreserver.getViewData.
    const source = normalizedText(snapshot.source), note = parseNote(source);
    const surface = this.scroller(view);
    if (!surface) return;
    // A scroll delivered after layout changes may precede its DOM scroll event.
    if (surface !== this.surface || Math.abs(surface.scrollTop - this.scrollTop) > 1) this.previous = null;
    this.surface = surface;
    const scroll = view.currentMode.getScroll();
    const offsets = lineOffsets(source);
    const offset = offsets[Math.max(0, Math.floor(Number.isFinite(scroll) ? scroll : 0))] ?? source.length;
    const index = navigationIndex(note.proposals, offset, direction, this.previous);
    if (index === null) return;
    const proposal = note.proposals[index];
    const group = this.mode === "source" ? undefined : reviewGroups(note).find(group => group.proposals.some(candidate => candidate.id === proposal.id));
    const from = group?.from ?? proposal.from;
    const line = offsets.findLastIndex(offset => offset <= from);
    this.clearTarget();
    this.busy = true; this.message = "";
    const generation = ++this.generation, mode = this.mode;
    this.changed();
    void this.reveal(snapshot, mode, proposal, group?.id, from, line, index, generation);
  }

  private viewMode(view: MarkdownView): string {
    if (view.getMode() === "preview") return "reading";
    return this.editorView(view)?.state.field(editorLivePreviewField, false) ? "live" : "source";
  }

  private scroller(view: MarkdownView): HTMLElement | null {
    return view.contentEl.querySelector<HTMLElement>(view.getMode() === "preview" ? ".markdown-reading-view .markdown-preview-view" : ".markdown-source-view .cm-scroller");
  }

  private valid(snapshot: ReviewSnapshot, mode: string, generation: number): boolean {
    if (this.stopped || this.generation !== generation || !snapshot.view.contentEl.isConnected || snapshot.view.contentEl.win.closed) return false;
    const current = this.read();
    return !!current && !current.busy && current.pending > 1 && current.view === snapshot.view && current.file === snapshot.file && current.source === snapshot.source && this.viewMode(current.view) === mode;
  }

  private async reveal(snapshot: ReviewSnapshot, mode: string, proposal: Proposal, groupId: string | undefined, from: number, line: number, index: number, generation: number): Promise<void> {
    const { view } = snapshot, win = view.contentEl.win;
    try {
      // Let the button's focus/blur finish before measuring replacement widgets.
      await this.frame(win);
      if (!this.valid(snapshot, mode, generation)) return;
      if (mode === "reading") {
        // The native line path expands folded headings and handles preview virtualization.
        view.setEphemeralState({ line });
      } else {
        const cm = this.editorView(view);
        if (!cm) return;
        const effects = [revealComparisons.of(null), EditorView.scrollIntoView(from, { y: "start", yMargin: 16 })];
        foldedRanges(cm.state).between(0, cm.state.doc.length, (start, end) => {
          if (start <= from && from <= end) effects.push(unfoldEffect.of({ from: start, to: end }));
        });
        cm.dispatch({ effects });
      }
      const deadline = win.performance.now() + 2500;
      let stable = 0, previousTop = NaN;
      while (win.performance.now() < deadline) {
        await this.frame(win);
        if (!this.valid(snapshot, mode, generation)) return;
        const surface = this.scroller(view);
        const selector = groupId ? ".inline-diff-review[data-inline-diff-ready=true]" : ".inline-diff-source-mark";
        const elements = [...view.contentEl.querySelectorAll<HTMLElement>(selector)].filter(element => surface?.contains(element) &&
          (groupId ? element.dataset.inlineDiffGroup === groupId : element.dataset.inlineDiffId === proposal.id));
        const target = elements.find(element => element.getBoundingClientRect().height > 0);
        if (!surface || !target) { stable = 0; continue; }
        // Adjust only this pane's vertical scroller, preserving horizontal position.
        const delta = target.getBoundingClientRect().top - surface.getBoundingClientRect().top - 16;
        surface.scrollTop += delta;
        const top = target.getBoundingClientRect().top;
        stable = Math.abs(top - previousTop) < .5 ? stable + 1 : 0;
        previousTop = top;
        if (stable < 3) continue;
        this.surface = surface; this.scrollTop = surface.scrollTop;
        this.previous = index; this.message = `Change ${index + 1} of ${snapshot.pending}`;
        for (const element of elements) element.classList.add("inline-diff-navigation-target");
        this.highlights = elements;
        const timer = win.setTimeout(() => this.clearTarget(), 1500);
        this.clearHighlight = () => win.clearTimeout(timer);
        return;
      }
      new Notice("Could not reveal the change. Try again after the note finishes rendering.");
    } catch (error) {
      if (this.valid(snapshot, mode, generation)) {
        new Notice("Could not navigate to the change. The note has not been modified.");
        console.error("Inline Diff: navigation failed", error);
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        if (!this.valid(snapshot, mode, generation)) this.reset();
        this.changed();
      }
    }
  }

  private bind(host: HTMLElement): void {
    this.inputHost = host;
    const manual = () => { this.reset(); this.changed(); };
    this.registerDomEvent(host, "wheel", event => { if (event.deltaY) manual(); }, { passive: true, capture: true });
    this.registerDomEvent(host, "touchstart", event => {
      if (!(event.target as Element).closest(".inline-diff-review-bar")) manual();
    }, { passive: true });
    this.registerDomEvent(host, "pointerdown", event => {
      if (!(event.target as Element).closest(".inline-diff-review-bar")) manual();
    }, true);
    this.registerDomEvent(host, "keydown", event => {
      if (["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "].includes(event.key) && !(event.target as Element).closest(".inline-diff-review-bar")) manual();
    }, true);
    this.registerDomEvent(host, "scroll", event => {
      const surface = this.surface;
      if (!this.busy && surface && event.target === surface && Math.abs(surface.scrollTop - this.scrollTop) > 1) manual();
    }, true);
  }

  private frame(win: Window): Promise<void> {
    return new Promise(resolve => {
      const finish = () => {
        win.cancelAnimationFrame(frame); win.clearTimeout(timer);
        this.waits.delete(finish); resolve();
      };
      const frame = win.requestAnimationFrame(finish), timer = win.setTimeout(finish, 50);
      this.waits.add(finish);
    });
  }

  private clearTarget(): void {
    this.clearHighlight?.(); this.clearHighlight = null;
    for (const element of this.highlights) element.classList.remove("inline-diff-navigation-target");
    this.highlights = [];
  }

  private reset(): void {
    this.generation++; this.busy = false; this.previous = null; this.message = "";
    this.clearTarget();
    for (const finish of this.waits) finish();
    this.surface = null;
  }
}
