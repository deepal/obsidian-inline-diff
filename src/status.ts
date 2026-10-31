import { Component, setIcon, setTooltip, type MarkdownView, type TFile } from "obsidian";
import type { Decision } from "./model";

export interface BulkReviewTarget { view: MarkdownView; file: TFile | null; source: string }
export interface ReviewSnapshot extends BulkReviewTarget { pending: number; editable: boolean; busy: boolean }

class ReviewActions extends Component {
  readonly element: HTMLElement;
  constructor(parent: HTMLElement, resolve: (decision: Decision) => void) {
    super();
    this.element = parent.createSpan({ cls: "inline-diff-review-bar-actions" });
    for (const [decision, icon, label] of [["accept", "check", "Accept all changes in this note"], ["reject", "x", "Reject all changes in this note"]] as const) {
      const button = this.element.createEl("button");
      button.type = "button"; button.dataset.decision = decision;
      button.setAttribute("aria-label", label);
      setIcon(button.createSpan(), icon); setTooltip(button, label);
      button.createSpan({ text: decision === "accept" ? "Accept all" : "Reject all" });
      this.registerDomEvent(button, "click", event => { event.preventDefault(); event.stopPropagation(); resolve(decision); });
    }
    this.register(() => this.element.remove());
  }
  setBusy(busy: boolean): void {
    for (const button of this.element.querySelectorAll("button")) button.disabled = busy;
  }
}

/** The bar sits outside both scrolling Markdown surfaces, in its owning pane. */
export class ReviewBar extends Component {
  readonly element: HTMLElement;
  readonly document: Document;
  private count: HTMLElement;
  private actions?: ReviewActions;
  private snapshot: ReviewSnapshot | null = null;
  private stopped = false;

  constructor(readonly host: HTMLElement, private read: () => ReviewSnapshot | null, private resolve: (target: BulkReviewTarget, decision: Decision) => void, measure: () => void = () => {}) {
    super();
    this.document = host.ownerDocument;
    const element = this.element = host.createDiv({ cls: "inline-diff-review-bar" });
    host.prepend(element); element.hidden = true;
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Pending changes in this note");
    this.count = element.createSpan({ cls: "inline-diff-review-bar-count" });
    this.count.setAttribute("role", "status"); this.count.setAttribute("aria-live", "polite");
    this.count.setAttribute("aria-atomic", "true");
    const observer = new this.document.defaultView!.ResizeObserver(measure);
    observer.observe(element);
    this.register(() => {
      this.stopped = true; this.snapshot = null; observer.disconnect();
      host.classList.remove("inline-diff-has-review-bar"); element.remove();
      measure();
    });
  }

  refresh(): void {
    if (this.stopped) return;
    if (this.host.firstElementChild !== this.element) this.host.prepend(this.element);
    const snapshot = this.snapshot = this.read();
    const visible = !!snapshot && snapshot.pending > 0;
    this.element.hidden = !visible;
    this.host.classList.toggle("inline-diff-has-review-bar", visible);
    const label = visible ? `${snapshot.pending} pending ${snapshot.pending === 1 ? "change" : "changes"}` : "";
    if (this.count.textContent !== label) this.count.textContent = label;
    this.element.setAttribute("aria-busy", String(visible && snapshot.busy));
    if (visible && snapshot.editable) {
      if (!this.actions) this.actions = this.addChild(new ReviewActions(this.element, decision => this.activate(decision)));
      this.actions.setBusy(snapshot.busy);
    } else if (this.actions) {
      this.removeChild(this.actions); this.actions = undefined;
    }
  }

  private activate(decision: Decision): void {
    const displayed = this.snapshot, current = this.read();
    if (!displayed?.editable || displayed.busy || !current?.editable || current.busy || !current.pending ||
      displayed.view !== current.view || displayed.file !== current.file || displayed.source !== current.source) {
      this.refresh(); return;
    }
    this.resolve(displayed, decision);
  }
}

/** Owns one component per full Markdown view, including each popout document. */
export class ReviewBarCoordinator extends Component {
  private bars = new Map<MarkdownView, ReviewBar>();
  private timer: number | null = null;
  private stopped = false;

  constructor(private win: Window, private views: () => MarkdownView[], private read: (view: MarkdownView) => ReviewSnapshot | null, private resolve: (target: BulkReviewTarget, decision: Decision) => void, private measure: (view: MarkdownView) => void) {
    super();
    this.register(() => {
      this.stopped = true; this.cancel();
      for (const bar of this.bars.values()) this.removeChild(bar);
      this.bars.clear();
    });
  }

  schedule(): void {
    if (this.stopped || this.timer !== null) return;
    // Timers also refresh unfocused panes, where animation frames can pause.
    this.timer = this.win.setTimeout(() => { this.timer = null; this.refresh(); }, 0);
  }

  refresh(): void {
    if (this.stopped) return;
    this.cancel();
    const views = new Set(this.views().filter(view => view.file && view.contentEl.isConnected && !view.contentEl.win.closed));
    for (const [view, bar] of this.bars) if (!views.has(view) || bar.host !== view.contentEl || bar.document !== view.contentEl.ownerDocument) {
      this.removeChild(bar); this.bars.delete(view);
    }
    for (const view of views) {
      let bar = this.bars.get(view);
      if (!bar) {
        bar = this.addChild(new ReviewBar(view.contentEl, () => this.read(view), this.resolve, () => this.measure(view)));
        this.bars.set(view, bar);
      }
      bar.refresh();
    }
  }

  private cancel(): void {
    if (this.timer !== null) this.win.clearTimeout(this.timer);
    this.timer = null;
  }
}
