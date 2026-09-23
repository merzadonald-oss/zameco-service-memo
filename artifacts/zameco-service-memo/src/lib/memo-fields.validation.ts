import assert from "node:assert/strict";
import { dateForInput } from "./memo-fields";

assert.equal(dateForInput("2026-09-23T00:00:00.000Z"), "2026-09-23");
assert.equal(dateForInput("2026-09-23"), "2026-09-23");
assert.equal(dateForInput("August 20, 2026"), "2026-08-20");
assert.equal(dateForInput("8/20/2026"), "2026-08-20");
assert.equal(dateForInput("2026-02-30"), "");
assert.equal(dateForInput("unreadable"), "");
console.log("Memo review date autofill validation passed");