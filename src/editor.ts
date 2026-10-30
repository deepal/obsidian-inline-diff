import { Prec, StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, MarkdownView, type TFile } from "obsidian";
import { parseNote, reviewGroups, type ParsedNote, type ReviewGroup } from "./model";
import { Comparison } from "./render";
import { applyColours } from "./settings";
import type InlineDiffPlugin from "./main";

export const refreshDiffs = StateEffect.define<null>();
interface Model { note: ParsedNote; groups: ReviewGroup[]; decorations: DecorationSet }

function markdownView(state: EditorState): MarkdownView | null {
  const info = state.field(editorInfoField, false);
  return info instanceof MarkdownView ? info : null;
}

/** Private host access is isolated here; cell editors must not own full-note UI. */
function canonicalDocument(state: EditorState): unknown {
  const editor: unknown = state.field(editorInfoField, false)?.editor;
  if (!editor || typeof editor !== "object" || !("cm" in editor)) return undefined;
  const cm = editor.cm;
  return cm instanceof EditorView ? cm.state.doc : undefined;
}

class ComparisonWidget extends WidgetType {
  private comparison?: Comparison;
  constructor(private plugin: InlineDiffPlugin, private note: ParsedNote, private group: ReviewGroup, private settingsVersion: number, private file: TFile | null, private sourcePath: string) { super(); }
  eq(other: ComparisonWidget): boolean { return this.note.source === other.note.source && this.group.from === other.group.from && this.group.to === other.group.to && this.settingsVersion === other.settingsVersion && this.file === other.file && this.sourcePath === other.sourcePath; }
  toDOM(editor: EditorView): HTMLElement {
    const view = markdownView(editor.state);
    this.comparison = new Comparison(this.plugin.app, editor.dom.ownerDocument, this.plugin, this.note, this.group, view?.file?.path ?? "", view, this.plugin.settings);
    this.plugin.addChild(this.comparison);
    return this.comparison.element;
  }
  destroy(): void {
    if (this.comparison) this.plugin.removeChild(this.comparison);
    this.comparison = undefined;
  }
  ignoreEvent(): boolean { return true; }
}

export function editorExtension(plugin: InlineDiffPlugin) {
  const build = (state: EditorState, note: ParsedNote, groups: ReviewGroup[], owned: boolean): Model => {
    if (!owned || !markdownView(state)) return { note, groups, decorations: Decoration.none };
    const decorations: { from: number; to: number; value: Decoration }[] = [];
    const live = state.field(editorLivePreviewField, false) ?? false;
    if (live && !groups.length) groups = reviewGroups(note);
    if (live) {
      for (const group of groups) {
        const editing = state.selection.ranges.some(range => range.from >= group.from && range.from < group.to);
        const file = markdownView(state)?.file ?? null;
        if (!editing) decorations.push({ from: group.from, to: group.to, value: Decoration.replace({ widget: new ComparisonWidget(plugin, note, group, plugin.settingsVersion, file, file?.path ?? ""), block: true }) });
        else addSource(group.proposals);
      }
    } else addSource(note.proposals);
    for (const diagnostic of note.diagnostics) {
      if (diagnostic.to > diagnostic.from) decorations.push({ from: diagnostic.from, to: diagnostic.to, value: Decoration.mark({ class: "inline-diff-diagnostic", attributes: { title: diagnostic.message } }) });
    }
    function addSource(proposals: ParsedNote["proposals"]) {
      for (const proposal of proposals) {
        const attributes = { "data-inline-diff-id": proposal.id };
        decorations.push({ from: proposal.from, to: proposal.to, value: Decoration.mark({ class: "inline-diff-source-mark", attributes }) });
        for (const [range, name] of [[proposal.beforeRange, "deletion"], [proposal.afterRange, "addition"]] as const) {
          if (range.to > range.from && (name !== "deletion" || proposal.kind !== "addition") && (name !== "addition" || proposal.kind !== "deletion")) {
            decorations.push({ from: range.from, to: range.to, value: Decoration.mark({ class: `inline-diff-source-mark inline-diff-${name}`, attributes }) });
          }
        }
      }
    }
    return { note, groups, decorations: Decoration.set(decorations.map(range => range.value.range(range.from, range.to)), true) };
  };
  const field = StateField.define<Model>({
    create(state) {
      const note = parseNote(state.doc.toString());
      const canonical = canonicalDocument(state);
      return build(state, note, [], !canonical || canonical === state.doc);
    },
    update(model, transaction) {
      const canonical = canonicalDocument(transaction.startState);
      const owned = !canonical || canonical === transaction.startState.doc;
      if (transaction.docChanged) {
        const note = parseNote(transaction.newDoc.toString());
        return build(transaction.state, note, [], owned);
      }
      if (transaction.selection || transaction.effects.some(effect => effect.is(refreshDiffs)) || transaction.reconfigured) return build(transaction.state, model.note, model.groups, owned);
      return model;
    },
    // Native table/callout replacement widgets are installed after extensions
    // in a newly created pane. Explicit precedence makes review ownership
    // independent of installation order (including popouts and startup).
    provide: field => Prec.highest(EditorView.decorations.from(field, model => model.decorations)),
  });
  const events = ViewPlugin.fromClass(class {
    private frame: number | null;
    constructor(private view: EditorView) {
      view.dom.classList.add("inline-diff-editor"); applyColours(view.dom, plugin.settings);
      // Newly created editors (notably popouts) can initialize this field before
      // Obsidian installs editorInfoField. Re-evaluate after the host attaches it.
      this.frame = view.dom.win.requestAnimationFrame(() => {
        this.frame = null;
        if (view.dom.isConnected) view.dispatch({ effects: refreshDiffs.of(null) });
      });
    }
    update(): void { /* Decorations own rendering; event handlers inspect current state. */ }
    destroy(): void {
      if (this.frame !== null) this.view.dom.win.cancelAnimationFrame(this.frame);
      this.view.dom.classList.remove("inline-diff-editor");
      applyColours(this.view.dom, { additionText: "", additionBackground: "", deletionText: "", deletionBackground: "" });
    }
  }, { eventHandlers: {
    pointerover(event, editor) {
      if (!plugin.isActive) return;
      const target = event.target as HTMLElement;
      const anchor = target.closest<HTMLElement>("[data-inline-diff-id]");
      const view = markdownView(editor.state);
      const model = editor.state.field(field);
      const proposal = model.note.proposals.find(p => p.id === anchor?.dataset.inlineDiffId);
      if (anchor && view && proposal) plugin.overlay(editor.dom.ownerDocument).show(anchor, { view, file: view.file, source: model.note.source, proposal });
    },
    pointerleave(_event, editor) { plugin.scheduleOverlayHide(editor.dom.ownerDocument); },
  } });
  return [EditorView.editorAttributes.of({ class: "inline-diff-editor" }), field, events];
}
