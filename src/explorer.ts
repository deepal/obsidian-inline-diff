import { Component, setIcon, setTooltip, TFile, TFolder, Vault, type App, type TAbstractFile } from "obsidian";
import { parseNote } from "./model";

const badgeClass = "inline-diff-explorer-badge";
const maxReads = 4;

interface FileCount {
  path: string;
  pending?: number;
}

/** Owns the badges and the dependency on the built-in File Explorer's markup. */
export class ExplorerBadges extends Component {
  private observers = new Map<HTMLElement, MutationObserver>();
  private saved = new WeakMap<TFile, FileCount>();
  private badges = new Set<HTMLElement>();
  private active = false;
  private frame: number | null = null;
  private reads = 0;

  constructor(private app: App, private liveCounts: (files: ReadonlySet<TFile>) => ReadonlyMap<TFile, number | null>) { super(); }

  onload(): void {
    this.active = true;
    const { workspace, vault } = this.app;
    workspace.onLayoutReady(() => this.schedule());
    this.registerEvent(workspace.on("layout-change", () => this.schedule()));
    this.registerEvent(workspace.on("window-open", () => this.schedule()));
    this.registerEvent(workspace.on("window-close", () => this.schedule()));
    this.registerEvent(workspace.on("file-open", () => this.schedule()));
    const invalidate = (file: TAbstractFile) => {
      const forget = (entry: TAbstractFile) => { if (entry instanceof TFile) this.saved.delete(entry); };
      if (file instanceof TFolder) Vault.recurseChildren(file, forget);
      else forget(file);
      this.schedule();
    };
    this.registerEvent(vault.on("create", invalidate));
    this.registerEvent(vault.on("modify", invalidate));
    this.registerEvent(vault.on("rename", invalidate));
    this.registerEvent(vault.on("delete", invalidate));
    this.schedule();
  }

  onunload(): void {
    this.active = false;
    if (this.frame !== null) this.app.workspace.containerEl.win.cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const [root, observer] of this.observers) this.detach(root, observer);
    this.observers.clear();
    for (const badge of this.badges) badge.remove();
    this.badges.clear();
  }

  schedule(): void {
    if (!this.active || this.frame !== null) return;
    this.frame = this.app.workspace.containerEl.win.requestAnimationFrame(() => {
      this.frame = null;
      this.reconcile();
    });
  }

  private reconcile(): void {
    const roots = new Set(this.app.workspace.getLeavesOfType("file-explorer")
      .map(leaf => leaf.view.containerEl).filter(root => root.isConnected && !root.win.closed));
    for (const [root, observer] of this.observers) {
      if (!roots.has(root)) { this.detach(root, observer); this.observers.delete(root); }
    }

    const files = new Set<TFile>();
    const rows = new Map<HTMLElement, { title: HTMLElement; file: TFile }[]>();
    for (const root of roots) {
      const entries = [];
      for (const row of root.querySelectorAll<HTMLElement>(".nav-file-title[data-path]")) {
        if (row.closest(".nav-folder.is-collapsed")) continue;
        const title = row.querySelector<HTMLElement>(":scope > .nav-file-title-content");
        const file = this.app.vault.getFileByPath(row.dataset.path ?? "");
        if (!title || file?.extension !== "md") continue;
        files.add(file);
        entries.push({ title, file });
      }
      rows.set(root, entries);
    }

    const live = this.liveCounts(files);
    const counts = new Map<TFile, number>();
    for (const file of files) {
      const pending = live.get(file) ?? this.savedCount(file);
      if (pending) counts.set(file, pending);
    }

    const wanted = new Set<HTMLElement>();
    for (const [root, entries] of rows) {
      let observer = this.observers.get(root);
      if (!observer) {
        const win = root.ownerDocument.defaultView;
        if (!win) continue;
        observer = new win.MutationObserver(() => this.schedule());
        this.observers.set(root, observer);
      }
      observer.disconnect();
      try {
        for (const { title, file } of entries) {
          const pending = counts.get(file);
          if (pending) wanted.add(this.paint(title, pending));
        }
        for (const badge of root.querySelectorAll<HTMLElement>(`.${badgeClass}`)) {
          if (!wanted.has(badge)) badge.remove();
        }
      } finally {
        observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "data-path"] });
      }
    }
    // Obsidian can keep a detached row around for later reuse.
    for (const badge of this.badges) {
      if (!wanted.has(badge)) { badge.remove(); this.badges.delete(badge); }
    }
  }

  private savedCount(file: TFile): number | undefined {
    const entry = this.saved.get(file);
    if (entry?.path === file.path) return entry.pending;
    if (this.reads < maxReads) {
      const next = { path: file.path };
      this.saved.set(file, next);
      this.reads++;
      void this.read(file, next);
    }
  }

  private async read(file: TFile, entry: FileCount): Promise<void> {
    try {
      const source = await this.app.vault.cachedRead(file);
      if (this.active && this.saved.get(file) === entry && file.path === entry.path && this.app.vault.getFileByPath(entry.path) === file) {
        entry.pending = parseNote(source).proposals.length;
      }
    } catch {
      // Leave this entry unknown until a vault event invalidates it.
    } finally {
      this.reads--;
      this.schedule();
    }
  }

  private paint(title: HTMLElement, count: number): HTMLElement {
    let badge = title.parentElement?.querySelector<HTMLElement>(`:scope > .${badgeClass}`);
    if (!badge || !this.badges.has(badge)) {
      badge?.remove();
      badge = title.createSpan({ cls: badgeClass, attr: { role: "img" } });
      title.after(badge);
      setIcon(badge, "file-diff");
      this.badges.add(badge);
    }
    const label = `${count} pending ${count === 1 ? "change" : "changes"}`;
    if (badge.getAttribute("aria-label") !== label) setTooltip(badge, label);
    return badge;
  }

  private detach(root: HTMLElement, observer: MutationObserver): void {
    observer.disconnect();
    root.querySelectorAll(`.${badgeClass}`).forEach(badge => badge.remove());
  }
}
