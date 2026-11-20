import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cn } from "../src/lib/utils";

describe("cn keeps the design tokens it is handed", () => {
  it("keeps a type-scale size beside a text colour", () => {
    assert.equal(cn("h-4 text-100 font-medium", "text-success"), "h-4 text-100 font-medium text-success");
    assert.equal(cn("text-200 font-medium text-text-muted"), "text-200 font-medium text-text-muted");
    assert.equal(cn("text-text", "text-500 tracking-tight"), "text-text text-500 tracking-tight");
  });

  it("lets a later size or colour replace an earlier one", () => {
    assert.equal(cn("text-200", "text-300"), "text-300");
    assert.equal(cn("text-text", "text-text-muted"), "text-text-muted");
  });

  it("keeps an elevation beside a shadow colour and lets one elevation replace another", () => {
    assert.equal(cn("shadow-mid", "shadow-critical"), "shadow-mid shadow-critical");
    assert.equal(cn("shadow-low", "shadow-mid"), "shadow-mid");
  });
});
