import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accountFullName,
  accountInitials,
  accountShortName,
} from "../src/lib/account-identity";

describe("accountInitials", () => {
  it("takes the first and last name", () => {
    assert.equal(accountInitials("Alyssa Torres"), "AT");
    assert.equal(accountInitials("cody johnson"), "CJ");
  });

  it("uses the first and last of three or more names", () => {
    // A middle name must not push the avatar to three letters, which would
    // overflow the 20px circle in the bottom bar.
    assert.equal(accountInitials("Maria de la Cruz"), "MC");
  });

  it("gives a one-word name a single letter", () => {
    assert.equal(accountInitials("Cher"), "C");
  });

  it("ignores stray whitespace rather than reading it as a name", () => {
    assert.equal(accountInitials("  Alyssa   Torres  "), "AT");
    assert.equal(accountInitials("\tRuben\nOrtega "), "RO");
  });

  it("stays legible when the account has no name stored", () => {
    // The seed always supplies a name, but User.name is nullable and a
    // bootstrapped admin can be created without one.
    assert.equal(accountInitials(null), "?");
    assert.equal(accountInitials(undefined), "?");
    assert.equal(accountInitials("   "), "?");
  });

  it("counts an accented or non-latin letter as one letter", () => {
    assert.equal(accountInitials("Émile Ngô"), "ÉN");
    assert.equal(accountInitials("Ana Ñuñez"), "AÑ");
  });
});

describe("accountShortName", () => {
  it("is the first name, because that is what fits", () => {
    assert.equal(accountShortName("Alyssa Torres"), "Alyssa");
    assert.equal(accountShortName("Cher"), "Cher");
  });

  it("keeps the stored capitalisation", () => {
    assert.equal(accountShortName("alyssa torres"), "alyssa");
  });

  it("names the cell something rather than nothing", () => {
    assert.equal(accountShortName(null), "Account");
    assert.equal(accountShortName(" "), "Account");
  });
});

describe("accountFullName", () => {
  it("is the whole name with its spacing normalised", () => {
    assert.equal(accountFullName("  Alyssa   Torres "), "Alyssa Torres");
  });

  it("falls back to the same word the trigger uses", () => {
    // The panel and the bottom bar must not disagree about who is signed in.
    assert.equal(accountFullName(null), accountShortName(null));
  });
});
