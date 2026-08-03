import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

// The product was renamed from `CTX Chat` to Attend on 2026-08-03. These pin
// both halves of that decision: the retired names must not come back on a user
// surface, and the identifiers that were deliberately left alone must not be
// swept up by a later rename pass. Background:
// content/decisions/2026-08-03-product-renamed-to-attend.md

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const retiredNames = /CTX Chat|CTX Connect/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) {
      // Generated Prisma client, not authored source.
      return entry.name === "generated" ? [] : sourceFiles(path);
    }

    return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
  });
}

function read(...segments: string[]) {
  return readFileSync(join(repoRoot, ...segments), "utf8");
}

describe("product name", () => {
  describe("the retired names are gone", () => {
    it("does not appear anywhere in src", () => {
      const offenders = sourceFiles(join(repoRoot, "src")).filter((path) =>
        retiredNames.test(readFileSync(path, "utf8")),
      );

      assert.deepEqual(offenders, []);
    });

    it("does not appear in the installed-app manifest", () => {
      const manifest = JSON.parse(read("public", "manifest.webmanifest"));

      assert.equal(manifest.name, "Attend");
      assert.equal(manifest.short_name, "Attend");
    });

    it("does not appear in the package name", () => {
      assert.equal(JSON.parse(read("package.json")).name, "attend");
    });

    it("does not appear in the seed guard", () => {
      const seed = read("prisma", "seed.ts");

      assert.ok(!retiredNames.test(seed));
      assert.ok(seed.includes("ATTEND_ALLOW_DEMO_SEED"));
      assert.ok(!seed.includes("CTX_ALLOW_DEMO_SEED"));
    });
  });

  // Renaming either of these is a silent data change, not a rebrand: the
  // localStorage key resets every saved theme preference, and the seeded
  // addresses are login identifiers that already exist as rows and drive the
  // deployed DEMO_USER_EMAIL guardrail.
  describe("the deliberately retained identifiers are still in place", () => {
    it("keeps the ctx-theme persistence contract", () => {
      assert.ok(read("src", "app", "layout.tsx").includes('localStorage.getItem("ctx-theme")'));

      const toggle = read("src", "components", "theme-toggle.tsx");
      assert.ok(toggle.includes('window.localStorage.setItem("ctx-theme"'));
      assert.ok(toggle.includes('"ctx-theme-change"'));
    });

    it("keeps the seeded ctxchat.local login addresses", () => {
      assert.ok(read("src", "lib", "demo-seed.ts").includes("service@ctxchat.local"));
    });
  });
});
