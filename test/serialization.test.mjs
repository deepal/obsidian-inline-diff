import assert from "node:assert/strict";
import { test } from "node:test";
import { serializeReview } from "../src/serialization.ts";
import { parseNote } from "../src/model.ts";
import { importHostModule } from "./helpers.mjs";
const { FormatPreserver } = await importHostModule("src/formats.ts");

test("identical alternatives retain their selected newline bytes through save, undo and redo", () => {
  for (const bom of ["", "\uFEFF"]) for (const decision of ["accept", "reject"]) {
    const disk = bom + "{~~\r\nsame\n~>\r\nsame\r\n~~}\r\n";
    const source = disk.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const transition = serializeReview(disk, source, decision, parseNote(source).proposals[0]);
    assert.equal(transition.before, disk);
    assert.equal(transition.after, bom + (decision === "accept" ? "same\r\n" : "same\n"));
    let current = source;
    const view = { file: {}, data: disk.replace(/^\uFEFF/, ""), getViewData: () => current };
    const owner = new FormatPreserver(); owner.load(); owner.preserve(view, disk, transition);
    current = "same\n"; assert.equal(view.getViewData(), transition.after);
    view.data = transition.after;
    current = source; assert.equal(view.getViewData(), disk);
    current = "same\n"; assert.equal(view.getViewData(), transition.after);
    owner.unload();
  }
});

test("serialization follows exact duplicate ranges and bulk choices with unsaved edits", () => {
  const disk = "Prefix.\r\n{~~same~>first~~}\r\n{~~same~>second~~}\r\n";
  const source = "Unsaved.\n" + disk.replace(/\r\n/g, "\n");
  const target = parseNote(source).proposals[1];
  assert.equal(serializeReview(disk, source, "accept", target).after, "Unsaved.\r\nPrefix.\r\n{~~same~>first~~}\r\nsecond\r\n");
  assert.equal(serializeReview(disk, source, "reject").after, "Unsaved.\r\nPrefix.\r\nsame\r\nsame\r\n");
  assert.equal(serializeReview(disk, source, "accept", { ...target, from: target.from - 1 }), null);
});
