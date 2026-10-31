import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { MarkdownView, Notice, Plugin, type Editor } from "obsidian";
import { editorExtension, refreshDiffs } from "./editor";
import { parseNote, project, resolveProposal, type Decision, type ParsedNote, type Proposal } from "./model";
import { normalizedText, serializeReview } from "./serialization";
import { ReviewOverlay, type ReviewTarget } from "./overlay";
import { ReadingCoordinator } from "./reading";
import { applyColours, defaults, DiffSettingTab, normalizeSettings, type DiffSettings } from "./settings";
import { FormatPreserver } from "./formats";
import { PendingReviewStatus, type BulkReviewTarget, type ReviewStatusSnapshot } from "./status";

interface CellOwner { tableCell: unknown; destroyTableCell: () => void }
function isCellOwner(value: unknown): value is CellOwner {
  return !!value && typeof value === "object" && "tableCell" in value && "destroyTableCell" in value && typeof value.destroyTableCell === "function";
}

export default class InlineDiffPlugin extends Plugin {
  settings: DiffSettings = { ...defaults };
  settingsVersion = 0;
  readonly buildIdentity = `inline-diff:${this.manifest.version}:pending-review-status`;
  private overlays = new Map<Document, ReviewOverlay>();
  private reading!: ReadingCoordinator;
  private formats!: FormatPreserver;
  private editorModel!: ReturnType<typeof editorExtension>;
  private reviewStatus!: PendingReviewStatus;
  private readingNote?: ParsedNote;
  private stopped = false;
  private resolving = new Set<MarkdownView>();
  lastResolution: Promise<void> = Promise.resolve();
  get isActive(): boolean { return !this.stopped; }

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.formats = this.addChild(new FormatPreserver());
    this.editorModel = editorExtension(this);
    this.registerEditorExtension(this.editorModel.extension);
    this.reading = this.addChild(new ReadingCoordinator(this));
    this.registerMarkdownPostProcessor(this.reading.handle);
    this.addSettingTab(new DiffSettingTab(this.app, this));
    this.reviewStatus = this.addChild(new PendingReviewStatus(this.addStatusBarItem(), () => this.statusSnapshot(), (target, decision) => this.resolveAll(target, decision)));
    for (const decision of ["accept", "reject"] as const) {
      this.addCommand({ id: `${decision}-change`, name: `${decision === "accept" ? "Accept" : "Reject"} current change`, checkCallback: checking => {
        const view = this.editableView();
        if (!view) return false;
        const note = parseNote(view.editor.getValue());
        const cursor = view.editor.posToOffset(view.editor.getCursor());
        const proposal = note.proposals.find(p => p.from <= cursor && p.to >= cursor);
        if (!proposal) return false;
        if (!checking) this.resolve({ view, file: view.file, source: note.source, proposal }, decision);
        return true;
      } });
      this.addCommand({ id: `${decision}-all-changes`, name: `${decision === "accept" ? "Accept" : "Reject"} all changes`, checkCallback: checking => {
        const view = this.editableView();
        if (!view) return false;
        const note = parseNote(view.editor.getValue());
        if (!note.proposals.length) return false;
        if (!checking) this.resolveAll({ view, file: view.file, source: note.source }, decision);
        return true;
      } });
    }
    for (const direction of [1, -1]) this.addCommand({
      id: direction > 0 ? "next-change" : "previous-change", name: direction > 0 ? "Go to next change" : "Go to previous change",
      checkCallback: checking => {
        const view = this.editableView();
        if (!view) return false;
        const note = parseNote(view.editor.getValue());
        if (!note.proposals.length) return false;
        if (!checking) {
          const offset = view.editor.posToOffset(view.editor.getCursor());
          const proposal = direction > 0 ? note.proposals.find(p => p.from > offset) ?? note.proposals[0] : [...note.proposals].reverse().find(p => p.from < offset) ?? note.proposals[note.proposals.length - 1];
          view.editor.setCursor(view.editor.offsetToPos(proposal.from));
          view.editor.scrollIntoView({ from: view.editor.offsetToPos(proposal.from), to: view.editor.offsetToPos(proposal.to) }, true);
          view.editor.focus();
        }
        return true;
      },
    });
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { for (const overlay of this.overlays.values()) overlay.hide(); }));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, win) => {
      const overlay = this.overlays.get(win.document);
      if (overlay) { this.removeChild(overlay); this.overlays.delete(win.document); }
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.formats.prune(this.app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).filter((view): view is MarkdownView => view instanceof MarkdownView))));
    this.registerEvent(this.app.workspace.on("file-open", () => this.refreshViews()));
    this.registerEvent(this.app.vault.on("rename", () => this.refreshViews()));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.reviewStatus.refresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.reviewStatus.refresh()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.reviewStatus.refresh()));
    this.registerEvent(this.app.workspace.on("editor-change", () => this.scheduleReviewStatus()));
    this.registerEvent(this.app.workspace.on("quick-preview", () => this.scheduleReviewStatus()));
    this.registerEvent(this.app.vault.on("modify", () => this.scheduleReviewStatus()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleReviewStatus()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleReviewStatus()));
    this.app.workspace.onLayoutReady(() => { if (!this.stopped) this.reviewStatus.refresh(); });
  }

  overlay(doc: Document): ReviewOverlay {
    let overlay = this.overlays.get(doc);
    if (!overlay) { overlay = this.addChild(new ReviewOverlay(doc, (target, decision) => this.resolve(target, decision), this.app)); this.overlays.set(doc, overlay); }
    return overlay;
  }

  scheduleOverlayHide(doc: Document): void { this.overlays.get(doc)?.scheduleHide(); }
  scheduleReviewStatus(): void { this.reviewStatus?.schedule(); }

  private statusSnapshot(): ReviewStatusSnapshot | null {
    if (this.stopped) return null;
    const view = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit)?.view;
    if (!(view instanceof MarkdownView) || !view.file || !view.containerEl.isConnected || view.containerEl.ownerDocument !== this.reviewStatus.element.ownerDocument || this.app.vault.getAbstractFileByPath(view.file.path) !== view.file) return null;
    const cm = this.editorView(view.editor);
    let note = view.getMode() === "source" && cm ? this.editorModel.parsedNote(cm.state) : undefined;
    if (!note) {
      const source = view.getViewData();
      if (this.readingNote?.source !== source) this.readingNote = parseNote(source);
      note = this.readingNote;
    }
    return { view, file: view.file, source: note.source, pending: note.proposals.length, editable: this.canEdit(view), busy: this.resolving.has(view) };
  }

  private editableView(): MarkdownView | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view && this.canEdit(view) && !this.resolving.has(view) ? view : null;
  }

  private canEdit(view: MarkdownView): boolean {
    const cm = this.editorView(view.editor);
    return view.getMode() === "source" && !!view.file && !!cm && cm.dom.isConnected && view.containerEl.isConnected && !cm.dom.ownerDocument.defaultView?.closed && !cm.state.facet(EditorState.readOnly);
  }

  private editorView(editor: Editor): EditorView | null {
    const value: unknown = editor;
    if (value && typeof value === "object" && "cm" in value && value.cm instanceof EditorView) return value.cm;
    return null;
  }

  resolve(target: ReviewTarget, decision: Decision): void {
    if (this.stopped || !this.canEdit(target.view) || target.file !== target.view.file) return;
    const source = target.view.editor.getValue();
    const updated = resolveProposal(source, target.source, target.proposal, decision);
    if (updated === null) { new Notice("The note changed. Review the refreshed proposal and try again."); return; }
    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    this.queueResolution(target.view, target.source, disk => {
      this.replace(target.view, target.proposal.from, target.proposal.to, decision === "accept" ? target.proposal.after : target.proposal.before, disk, decision, target.proposal);
      if (this.app.workspace.getMostRecentLeaf() === activeLeaf) target.view.editor.focus();
    });
  }

  resolveAll(target: BulkReviewTarget, decision: Decision): void {
    const { view, file, source } = target;
    if (this.stopped || !this.canEdit(view) || view.file !== file) { this.reviewStatus.refresh(); return; }
    if (view.editor.getValue() !== source) {
      new Notice("The note changed. Review the refreshed proposals and try again."); this.reviewStatus.refresh(); return;
    }
    const cm = this.editorView(view.editor);
    const note = cm && this.editorModel.parsedNote(cm.state) || parseNote(source);
    if (!note.proposals.length) { this.reviewStatus.refresh(); return; }
    const activeLeaf = this.app.workspace.getMostRecentLeaf();
    this.queueResolution(view, source, disk => {
      this.replace(view, 0, source.length, project(note, decision).text, disk, decision);
      if (this.app.workspace.getMostRecentLeaf() === activeLeaf && this.app.workspace.getActiveViewOfType(MarkdownView) === view) view.editor.focus();
    });
  }

  private queueResolution(view: MarkdownView, source: string, operation: (disk: string) => void): void {
    const file = view.file;
    if (!file || this.resolving.has(view)) return;
    this.resolving.add(view);
    this.reviewStatus.refresh();
    this.lastResolution = (async () => {
      try {
        const bytes = await this.app.vault.adapter.readBinary(file.path);
        const disk = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
        const normalized = (text: string) => text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
        if (this.stopped) return;
        if (!this.canEdit(view) || view.file !== file || this.app.vault.getAbstractFileByPath(file.path) !== file || view.editor.getValue() !== source || normalized(disk) !== normalized(view.data)) {
          new Notice("The note changed. Review the refreshed proposal and try again."); return;
        }
        operation(disk);
      } catch (error) {
        new Notice("Could not safely read the note. The proposal is still pending.");
        console.error("Inline Diff: review failed", error);
      } finally { this.resolving.delete(view); this.reviewStatus.refresh(); }
    })();
  }

  private replace(view: MarkdownView, from: number, to: number, insert: string, original: string, decision: Decision, proposal?: Proposal): void {
    const cm = this.editorView(view.editor);
    if (!cm || !this.canEdit(view)) return;
    const source = cm.state.doc.toString();
    const editor: unknown = view.editor;
    const component = editor && typeof editor === "object" && "editorComponent" in editor ? editor.editorComponent : undefined;
    // Editor.focus() targets activeCM, which can be a cell editor with its own
    // history. Close that editor through the guarded host adapter before making
    // a root-document review transaction. This does not edit the cell content.
    if (component && typeof component === "object" && "tableCell" in component && component.tableCell) {
      if (!isCellOwner(component)) { new Notice("Finish editing the table cell before reviewing this change."); return; }
      component.destroyTableCell();
      if (cm.state.doc.toString() !== source) { new Notice("The table changed. Review the refreshed proposal and try again."); return; }
    }
    const serialized = serializeReview(original, source, decision, proposal);
    if (!serialized || normalizedText(serialized.after) !== normalizedText(source.slice(0, from) + insert + source.slice(to))) {
      new Notice("The note format changed. Review the refreshed proposal and try again."); return;
    }
    this.formats.preserve(view, original, serialized);
    cm.dispatch({ changes: { from, to, insert }, annotations: isolateHistory.of("full") });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.settingsVersion++;
    this.refreshViews();
  }

  private refreshViews(): void {
    if (this.stopped) return;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const cm = this.editorView(view.editor);
      if (cm) { applyColours(cm.dom, this.settings); cm.dispatch({ effects: refreshDiffs.of(null) }); }
    }
    this.reading.refresh();
  }

  onunload(): void { this.stopped = true; for (const overlay of this.overlays.values()) overlay.hide(); this.overlays.clear(); }
}
