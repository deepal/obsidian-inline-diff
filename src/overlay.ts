import { Component, Scope, setIcon, setTooltip, type App, type MarkdownView, type TFile } from "obsidian";
import type { Decision, Proposal } from "./model";

export interface ReviewTarget { view: MarkdownView; file: TFile | null; source: string; proposal: Proposal }

/** One floating toolbar per document, including each popout document. */
export class ReviewOverlay extends Component {
  readonly element: HTMLElement;
  private target: ReviewTarget | null = null;
  private anchor: HTMLElement | null = null;
  private focusAnchor: HTMLElement | null = null;
  private timer: number | null = null;
  private frame: number | null = null;
  private observer: ResizeObserver;
  private modeObserver: MutationObserver;
  private scope?: Scope;
  private scopeActive = false;

  constructor(private doc: Document, private resolve: (target: ReviewTarget, decision: Decision) => void, private app?: App) {
    super();
    const win = doc.defaultView!;
    // The factory must use the owning popout document.
    this.element = doc.createElement("div");
    this.element.className = "inline-diff-toolbar";
    this.element.setAttribute("role", "toolbar");
    this.element.setAttribute("aria-label", "Review change");
    this.element.hidden = true;
    for (const [decision, icon, label] of [["accept", "check", "Accept change"], ["reject", "x", "Reject change"]] as const) {
      // Keep buttons in the owning popout document.
      const button = doc.createElement("button");
      button.type = "button"; button.className = "clickable-icon";
      button.dataset.decision = decision;
      button.setAttribute("aria-label", label);
      setIcon(button, icon); setTooltip(button, label);
      this.registerDomEvent(button, "mousedown", event => { event.preventDefault(); event.stopPropagation(); });
      this.registerDomEvent(button, "click", event => {
        event.preventDefault(); event.stopPropagation();
        const target = this.target; this.hide();
        if (target) this.resolve(target, decision);
      });
      this.element.append(button);
    }
    this.registerDomEvent(this.element, "pointerenter", () => this.cancelHide());
    this.registerDomEvent(this.element, "pointerleave", () => this.scheduleHide());
    if (app) {
      this.scope = new Scope(app.scope);
      this.scope.register([], "Escape", () => { this.escape(); return false; });
    }
    this.registerDomEvent(this.element, "focusin", () => {
      this.cancelHide();
      if (this.scope && this.app && !this.scopeActive) { this.app.keymap.pushScope(this.scope); this.scopeActive = true; }
    });
    this.registerDomEvent(this.element, "focusout", () => {
      queueMicrotask(() => {
        if (!this.element.contains(doc.activeElement)) { this.releaseScope(); this.scheduleHide(); }
      });
    });
    this.registerDomEvent(doc, "scroll", () => this.schedulePosition(), true);
    this.registerDomEvent(win, "resize", () => this.schedulePosition());
    this.registerDomEvent(doc, "keydown", event => {
      if (event.key === "Escape") this.escape();
    });
    this.observer = new win.ResizeObserver(() => this.schedulePosition());
    this.modeObserver = new win.MutationObserver(() => {
      if (this.target && (this.target.view.getMode() !== "source" || !this.anchor?.isConnected)) this.hide();
      else this.schedulePosition();
    });
    this.register(() => {
      this.hide(); this.observer.disconnect(); this.modeObserver.disconnect();
      if (this.frame !== null) win.cancelAnimationFrame(this.frame);
      this.element.remove();
    });
  }

  show(anchor: HTMLElement, target: ReviewTarget, focusAnchor = anchor): void {
    if (target.view.getMode() !== "source" || !anchor.isConnected) { this.hide(); return; }
    this.cancelHide(); this.observer.disconnect();
    this.anchor = anchor; this.focusAnchor = focusAnchor; this.target = target;
    this.observer.observe(anchor);
    this.observer.observe(target.view.contentEl?.querySelector(".cm-content") ?? target.view.containerEl);
    this.modeObserver.disconnect();
    this.modeObserver.observe(target.view.containerEl, { childList: true, subtree: true, attributes: true });
    this.doc.body.append(this.element);
    this.element.hidden = false;
    this.position();
  }

  scheduleHide(): void {
    this.cancelHide();
    this.timer = this.doc.defaultView!.setTimeout(() => {
      if (!this.element.contains(this.doc.activeElement)) this.hide();
    }, 180);
  }

  focus(): void { this.cancelHide(); this.element.querySelector<HTMLButtonElement>("button")?.focus(); }

  private escape(): void {
    const restore = this.element.contains(this.doc.activeElement), anchor = this.focusAnchor, view = this.target?.view;
    this.hide();
    if (restore) { if (anchor && anchor.tabIndex >= 0) anchor.focus(); else view?.editor.focus(); }
  }

  private releaseScope(): void {
    if (this.scope && this.app && this.scopeActive) this.app.keymap.popScope(this.scope);
    this.scopeActive = false;
  }

  private cancelHide(): void {
    if (this.timer !== null) this.doc.defaultView!.clearTimeout(this.timer);
    this.timer = null;
  }

  hide(): void {
    this.releaseScope(); this.cancelHide(); this.element.hidden = true; this.element.remove(); this.target = null; this.anchor = null; this.focusAnchor = null; this.observer.disconnect(); this.modeObserver.disconnect();
  }

  private schedulePosition(): void {
    if (this.element.hidden || this.frame !== null) return;
    this.frame = this.doc.defaultView!.requestAnimationFrame(() => { this.frame = null; this.position(); });
  }

  private position(): void {
    if (!this.anchor?.isConnected || this.target?.view.getMode() !== "source") { this.hide(); return; }
    const win = this.doc.defaultView!;
    const rect = this.anchor.getBoundingClientRect();
    const surface = this.target.view.contentEl?.querySelector<HTMLElement>(".markdown-source-view .cm-scroller");
    const pane = (surface ?? this.target.view.containerEl).getBoundingClientRect();
    if (rect.bottom < pane.top || rect.top > pane.bottom) { this.hide(); return; }
    const width = this.element.offsetWidth;
    const height = this.element.offsetHeight;
    const left = Math.max(pane.left + 4, Math.min(rect.right - width, pane.right - width - 4, win.innerWidth - width - 4));
    let top = Math.max(pane.top + 4, Math.min(rect.top - height + 4, pane.bottom - height - 4, win.innerHeight - height - 4));
    // At the top edge, an above-hunk clamp can cover a small image or edit.
    // Keep the hovered hunk reachable while the toolbar is visible.
    if (this.anchor.classList.contains("inline-diff-unit") && left < rect.right && left + width > rect.left && top < rect.bottom && top + height > rect.top) {
      const below = rect.bottom + 4;
      if (below + height <= Math.min(pane.bottom, win.innerHeight) - 4) top = below;
    }
    this.element.setCssProps({ left: `${left}px`, top: `${top}px` });
  }
}
