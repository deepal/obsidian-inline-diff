import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export const highlightSource = StateEffect.define<{ from: number; to: number } | null>();

/** Keep temporary Source outlines in CodeMirror's DOM ownership. */
export const sourceHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    if (transaction.docChanged) return Decoration.none;
    for (const effect of transaction.effects) if (effect.is(highlightSource)) {
      const range = effect.value;
      value = range && range.from >= 0 && range.to > range.from && range.to <= transaction.newDoc.length
        ? Decoration.set([Decoration.mark({ class: "inline-diff-navigation-target" }).range(range.from, range.to)]) : Decoration.none;
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field),
});
