import assert from "node:assert/strict";
import { test } from "node:test";
import { preserveLineEndings } from "../src/line-endings.ts";
import { parseNote, project } from "../src/model.ts";
import { importHostModule } from "./helpers.mjs";

test("CRLF and mixed endings survive individual decisions and undo", () => {
  for (const eol of ["\n", "\r\n"]) for (const final of ["", "\r\n"]) {
    const source = `---\r\nname: unchanged\r\n---${eol}A {~~old~>new~~} line.\r\n${eol}Tail.${final}`;
    const normalized = source.replace(/\r\n/g, "\n");
    for (const decision of ["accept", "reject"]) {
      const transformed = project(parseNote(normalized), decision).text;
      const expected = source.replace("{~~old~>new~~}", decision === "accept" ? "new" : "old");
      assert.equal(preserveLineEndings(source, transformed), expected);
      assert.equal(preserveLineEndings(expected, normalized), source);
    }
  }
});
test("selected multiline payload lines retain their own separators", () => {
  const source = "Prefix.\r\n\r\n{~~\nold\r\n~>\nnew\r\n~~}\n\nTail.\r\n";
  const selected = project(parseNote(source.replace(/\r\n/g, "\n")), "accept").text;
  assert.equal(preserveLineEndings(source, selected), "Prefix.\r\n\r\nnew\r\n\nTail.\r\n");
});
test("LF files and unchanged mixed files are byte-preserving", () => {
  assert.equal(preserveLineEndings("old\n", "new\n"), "new\n");
  assert.equal(preserveLineEndings("a\r\nb\nc", "a\nb\nc"), "a\r\nb\nc");
});
test("UTF-8 BOM survives the host's normalized buffer", () => {
  for (const eol of ["\n", "\r\n"]) for (const final of ["", eol]) {
    assert.equal(preserveLineEndings(`\uFEFFold${eol}Tail.${final}`, `new\nTail.${final.replace(/\r/g, "")}`), `\uFEFFnew${eol}Tail.${final}`);
  }
});
const { FormatPreserver } = await importHostModule("src/formats.ts");
test("serialization hook restores only its own override and follows file identity", () => {
  const formats = new FormatPreserver(); formats.load();
  const original = function() { return "new\n"; };
  const view = { file: {}, data: "old\r\n", getViewData: original };
  formats.preserve(view); assert.equal(view.getViewData(), "new\r\n");
  view.file = {}; assert.equal(view.getViewData(), "new\n");
  formats.unload(); assert.equal(view.getViewData, original);
});
test("unload does not clobber a later override installed by another plugin", () => {
  const formats = new FormatPreserver(); formats.load();
  const view = { file: {}, data: "old\r\n", getViewData: () => "new\n" };
  formats.preserve(view); const ours = view.getViewData;
  const other = function() { return ours.call(this); }; view.getViewData = other;
  formats.unload(); assert.equal(view.getViewData, other); assert.equal(view.getViewData(), "new\n");
});
