import { Component, Scope, setIcon, setTooltip, type App, type MarkdownView, type TFile } from "obsidian";
import type { Decision } from "./model";

export interface BulkReviewTarget { view: MarkdownView; file: TFile | null; source: string }
export interface ReviewSnapshot extends BulkReviewTarget { pending: number; editable: boolean; busy: boolean }
export type NavigationDirection = -1 | 1;
export interface NavigationController extends Component {
  readonly busy: boolean;
  readonly message: string;
  refresh(snapshot: ReviewSnapshot | null): void;
  go(direction: NavigationDirection): void;
}
export type NavigationFactory = (read: () => ReviewSnapshot | null, changed: () => void) => NavigationController;

class NavigationActions extends Component {
  readonly element: HTMLElement;
  readonly announcement: HTMLElement;
  private restoreFocus: HTMLButtonElement | null = null;
  private scope?: Scope;
  private scopeActive = false;
  constructor(parent: HTMLElement, navigate: (direction: NavigationDirection) => void, private app?: App) {
    super();
    this.element = parent.createSpan({ cls: "inline-diff-review-bar-navigation" });
    for (const [direction, icon, label] of [[-1, "arrow-up", "Previous change"], [1, "arrow-down", "Next change"]] as const) {
      const button = this.element.createEl("button", { cls: "clickable-icon" });
      button.type = "button"; button.dataset.direction = String(direction);
      button.setAttribute("aria-label", label); setIcon(button, icon); setTooltip(button, label);
      this.registerDomEvent(button, "click", event => {
        event.preventDefault(); event.stopPropagation();
        if (!button.disabled) { button.focus({ preventScroll: true }); navigate(direction); }
      });
      this.registerDomEvent(button, "keydown", event => {
        if (event.defaultPrevented || event.isComposing || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat) button.click();
      });
      this.registerDomEvent(button, "keyup", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); }
      });
    }
    this.announcement = this.element.createSpan({ cls: "inline-diff-navigation-status" });
    this.announcement.setAttribute("role", "status"); this.announcement.setAttribute("aria-live", "polite");
    this.announcement.setAttribute("aria-atomic", "true");
    if (app) {
      this.scope = new Scope(app.scope);
      for (const key of ["Enter", " "]) this.scope.register([], key, event => {
        const button = [...this.element.querySelectorAll("button")].find(button => button === this.element.ownerDocument.activeElement);
        if (button) {
          if (!event.isComposing && !event.repeat) button.click();
          return false;
        }
      });
    }
    this.registerDomEvent(this.element, "focusin", () => {
      if (this.scope && this.app && !this.scopeActive) { this.app.keymap.pushScope(this.scope); this.scopeActive = true; }
    });
    this.registerDomEvent(this.element, "focusout", () => {
      queueMicrotask(() => { if (!this.element.contains(this.element.ownerDocument.activeElement)) this.releaseScope(); });
    });
    const cancelFocus = (event: Event) => {
      if (!this.element.contains(event.target as Node)) this.restoreFocus = null;
    };
    this.registerDomEvent(parent.ownerDocument, "pointerdown", cancelFocus, true);
    this.registerDomEvent(parent.ownerDocument, "keydown", cancelFocus, true);
    this.registerDomEvent(parent.ownerDocument, "wheel", cancelFocus, { passive: true, capture: true });
    this.registerDomEvent(parent.ownerDocument, "touchstart", cancelFocus, { passive: true, capture: true });
    this.registerDomEvent(parent.win, "blur", () => { this.restoreFocus = null; });
    this.register(() => { this.releaseScope(); this.element.remove(); });
  }
  private releaseScope(): void {
    if (this.scope && this.app && this.scopeActive) this.app.keymap.popScope(this.scope);
    this.scopeActive = false;
  }
  update(disabled: boolean, message: string, settling: boolean): void {
    const doc = this.element.ownerDocument;
    if (disabled && !settling) this.restoreFocus = null;
    for (const button of this.element.querySelectorAll("button")) {
      if (disabled && settling && !button.disabled && doc.activeElement === button) this.restoreFocus = button;
      button.disabled = disabled;
    }
    if (!disabled && this.restoreFocus) {
      if (doc.activeElement === doc.body && doc.hasFocus()) this.restoreFocus.focus({ preventScroll: true });
      this.restoreFocus = null;
    }
    if (this.announcement.textContent !== message) this.announcement.textContent = message;
  }
}

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
  private navigation?: NavigationActions;
  private navigator?: NavigationController;
  private snapshot: ReviewSnapshot | null = null;
  private stopped = false;

  constructor(readonly host: HTMLElement, private read: () => ReviewSnapshot | null, private resolve: (target: BulkReviewTarget, decision: Decision) => void, measure: () => void = () => {}, createNavigation?: NavigationFactory, private app?: App) {
    super();
    this.document = host.ownerDocument;
    const element = this.element = host.createDiv({ cls: "inline-diff-review-bar" });
    host.prepend(element); element.hidden = true;
    element.setAttribute("role", "group");
    element.setAttribute("aria-label", "Pending changes in this note");
    this.count = element.createSpan({ cls: "inline-diff-review-bar-count" });
    this.count.setAttribute("role", "status"); this.count.setAttribute("aria-live", "polite");
    this.count.setAttribute("aria-atomic", "true");
    if (createNavigation) this.navigator = this.addChild(createNavigation(read, () => this.refresh()));
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
    this.navigator?.refresh(snapshot);
    const visible = !!snapshot && snapshot.pending > 0;
    this.element.hidden = !visible;
    this.host.classList.toggle("inline-diff-has-review-bar", visible);
    const label = visible ? `${snapshot.pending} pending ${snapshot.pending === 1 ? "change" : "changes"}` : "";
    if (this.count.textContent !== label) this.count.textContent = label;
    this.element.setAttribute("aria-busy", String(visible && (snapshot.busy || !!this.navigator?.busy)));
    if (visible) {
      if (!this.navigation) {
        this.navigation = this.addChild(new NavigationActions(this.element, direction => this.navigate(direction), this.app));
        this.count.after(this.navigation.element);
      }
      this.navigation.update(snapshot.pending <= 1 || snapshot.busy || !!this.navigator?.busy, this.navigator?.message ?? "", !!this.navigator?.busy && !snapshot.busy && snapshot.pending > 1);
    } else if (this.navigation) {
      this.removeChild(this.navigation); this.navigation = undefined;
    }
    if (visible && snapshot.editable) {
      if (!this.actions) this.actions = this.addChild(new ReviewActions(this.element, decision => this.activate(decision)));
      this.actions.setBusy(snapshot.busy);
    } else if (this.actions) {
      this.removeChild(this.actions); this.actions = undefined;
    }
  }

  private navigate(direction: NavigationDirection): void {
    const displayed = this.snapshot, current = this.read();
    if (!displayed || !current || current.pending <= 1 || current.busy || displayed.busy ||
      displayed.view !== current.view || displayed.file !== current.file || displayed.source !== current.source) {
      this.refresh(); return;
    }
    this.navigator?.go(direction);
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

  constructor(private win: Window, private views: () => MarkdownView[], private read: (view: MarkdownView) => ReviewSnapshot | null, private resolve: (target: BulkReviewTarget, decision: Decision) => void, private measure: (view: MarkdownView) => void, private createNavigation?: NavigationFactory, private app?: App) {
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
        bar = this.addChild(new ReviewBar(view.contentEl, () => this.read(view), this.resolve, () => this.measure(view), this.createNavigation, this.app));
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
