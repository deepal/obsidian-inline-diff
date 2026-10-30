import { diffLines } from "diff";

function lines(text: string): string[] { return text.match(/[^\n]*\n|[^\n]+$/g) ?? []; }
function ending(line: string): string { return line.endsWith("\r\n") ? "\r\n" : line.endsWith("\n") ? "\n" : ""; }

/** Restore original line separators without changing the editor's LF offsets. */
export function preserveLineEndings(original: string, current: string): string {
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  original = original.replace(/^\uFEFF/, "");
  current = current.replace(/^\uFEFF/, "");
  if (!original.includes("\r\n")) return bom + current;
  const normalized = original.replace(/\r\n/g, "\n");
  current = current.replace(/\r\n/g, "\n");
  if (normalized === current) return bom + original;
  const originalLines = lines(original);
  const crlf = originalLines.filter(line => ending(line) === "\r\n").length;
  const lf = originalLines.filter(line => ending(line) === "\n").length;
  const defaultEnding = crlf >= lf ? "\r\n" : "\n";
  let index = 0, output = "", removedEndings: string[] = [];
  for (const part of diffLines(normalized, current)) {
    const chunk = lines(part.value);
    if (part.removed) {
      removedEndings = originalLines.slice(index, index + chunk.length).map(ending);
      index += chunk.length;
    } else if (part.added) {
      for (const [offset, line] of chunk.entries()) {
        output += line.endsWith("\n") ? line.slice(0, -1) + (removedEndings[offset] || defaultEnding) : line;
      }
    } else {
      for (let offset = 0; offset < chunk.length; offset++) output += originalLines[index++];
      removedEndings = [];
    }
  }
  return bom + output;
}
