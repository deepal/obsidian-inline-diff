import { Component, setIcon, setTooltip, type MarkdownView, type TFile } from "obsidian";
import type { Decision } from "./model";

export interface BulkReviewTarget { view: MarkdownView; file: TFile | null; source: string }
export interface ReviewStatusSnapshot extends BulkReviewTarget { pending: number; editable: boolean; busy: boolean }

class StatusActions extends Component {
  readonly element: HTMLElement;
  constructor(parent: HTMLElement, resolve: (decision: Decision) => void) {
    super();
    this.element = parent.createSpan({ cls: "inline-diff-status-actions" });
    for (const [decision, icon, label] of [["accept", "check", "Accept all changes in this note"], ["reject", "x", "Reject all changes in this note"]] as const) {
      const button = this.element.createEl("button", { cls: "clickable-icon" });
      button.type = "button"; button.dataset.decision = decision;
      button.setAttribute("aria-label", label);
      setIcon(button, icon); setTooltip(button, label);
      this.registerDomEvent(button, "click", event => { event.preventDefault(); event.stopPropagation(); resolve(decision); });
    }
    this.register(() => this.element.remove());
  }
  setBusy(busy: boolean): void {
    for (const button of this.element.querySelectorAll("button")) button.disabled = busy;
  }
}

/** One native main-window status item. It never chooses a different action target. */
export class PendingReviewStatus extends Component {
  private count: HTMLElement;
  private actions?: StatusActions;
  private snapshot: ReviewStatusSnapshot | null = null;
  private timer: number | null = null;
  private stopped = false;

  constructor(readonly element: HTMLElement, private read: () => ReviewStatusSnapshot | null, private resolve: (target: BulkReviewTarget, decision: Decision) => void) {
    super();
    element.classList.add("inline-diff-status"); element.hidden = true;
    element.setAttribute("aria-label", "Pending changes in this note");
    this.count = element.createSpan({ cls: "inline-diff-status-count" });
    this.count.setAttribute("role", "status"); this.count.setAttribute("aria-live", "polite");
    this.count.setAttribute("aria-atomic", "true");
    this.register(() => {
      this.stopped = true; this.cancel(); this.snapshot = null;
      element.replaceChildren(); element.hidden = true;
    });
  }

  schedule(): void {
    if (this.stopped || this.timer !== null) return;
    // Timers also update counts in unfocused windows; animation frames can pause.
    this.timer = this.element.win.setTimeout(() => { this.timer = null; this.refresh(); }, 0);
  }

  refresh(): void {
    if (this.stopped) return;
    this.cancel();
    const snapshot = this.snapshot = this.read();
    const visible = !!snapshot && snapshot.pending > 0;
    this.element.hidden = !visible;
    const label = visible ? `${snapshot.pending} pending ${snapshot.pending === 1 ? "change" : "changes"}` : "";
    if (this.count.textContent !== label) this.count.textContent = label;
    this.element.setAttribute("aria-busy", String(visible && snapshot.busy));
    if (visible && snapshot.editable) {
      if (!this.actions) this.actions = this.addChild(new StatusActions(this.element, decision => this.activate(decision)));
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

  private cancel(): void {
    if (this.timer !== null) this.element.win.clearTimeout(this.timer);
    this.timer = null;
  }
}
