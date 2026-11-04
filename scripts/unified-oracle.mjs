/** Reconstruct either semantic alternative from the unified representation.
 * Expectations are authored independently and rendered by the native host. */
export function projectRendered(root, side) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('.inline-diff-evidence,.inline-diff-empty').forEach(node => node.remove());
  for (const pair of [...clone.querySelectorAll('.inline-diff-proposal')].reverse()) {
    const panel = [...pair.children].find(node => node.dataset.inlineDiffSide === side);
    const body = panel?.querySelector(':scope > .inline-diff-side-content');
    if (!body) throw new Error('Missing complete proposal side.');
    for (const shell of [...body.querySelectorAll('[data-inline-diff-shell]')].reverse()) shell.replaceWith(...shell.childNodes);
    const proxy = pair.closest('[data-inline-diff-proxy]');
    (proxy ?? pair).replaceWith(...body.childNodes);
  }
  for (const node of clone.querySelectorAll('.inline-diff-text,.inline-diff-fragment')) node.replaceWith(...node.childNodes);
  clone.querySelectorAll('[data-inline-diff-generated-container]').forEach(node => { if (!node.children.length) node.remove(); });
  // Restore comment-separator text as well as passive table layout shells.
  // A rendering-only hidden span must not weaken either source alternative.
  for (const node of [...clone.querySelectorAll('[data-inline-diff-layout]')].reverse()) node.replaceWith(...node.childNodes);
  for (const table of clone.querySelectorAll("[data-inline-diff-native-table]")) { table.classList.remove("table-editor"); table.removeAttribute("data-inline-diff-native-table"); }
  clone.normalize();
  return clone;
}

export function canonical(root) {
  function walk(node) {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    const el = node;
    if (el.matches(".inline-diff-empty,.copy-code-button,.footnote-backref,.collapse-indicator,.callout-icon,.callout-fold")) return "";
    if (el.matches(".inline-diff-text,.inline-diff-fragment")) return [...el.childNodes].map(walk).join("");
    if (el.matches(".pdf-embed")) return `<pdf alt=${JSON.stringify(el.getAttribute("alt"))}></pdf>`;
    if (el.matches("svg")) return `<svg>${[...el.querySelectorAll("text,foreignObject")].map(e => e.textContent).join("|")}</svg>`;
    if (el.matches(".math")) return `<math>${el.getAttribute("data-math") || el.textContent}</math>`;
    const attrs = ["href", "data-href", "data-callout", "data-src", "src", "alt", "align", "type", "width", "height", "title", "checked"].filter(name => el.hasAttribute(name)).map(name => {
      let value = el.getAttribute(name);
      if (name === "href" && el.closest(".footnotes,.footnote-ref")) value = "#footnote";
      return ` ${name}=${JSON.stringify(value)}`;
    }).join("");
    const children = [...el.childNodes].map(walk).join("");
    return `<${el.tagName.toLowerCase()}${attrs}>${children}</${el.tagName.toLowerCase()}>`;
  }
  return [...root.childNodes].map(walk).join("").replace(/>\s+</g, "><").replace(/\s+/g, " ").trim();
}
