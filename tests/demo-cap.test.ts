import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

// The module builds a Prisma client as it loads, which needs a connection string
// present but never opens it. Imported lazily so this is set first; nothing in
// here touches the database.
async function loadDemoAiDailyLimit() {
  process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";

  return (await import("../src/lib/ai/demo-cap")).demoAiDailyLimit;
}

const DEFAULT_LIMIT = 20;

function setLimit(value: string | undefined) {
  if (value === undefined) {
    delete process.env.DEMO_AI_DAILY_LIMIT;
    return;
  }

  process.env.DEMO_AI_DAILY_LIMIT = value;
}

afterEach(() => setLimit(undefined));

describe("demoAiDailyLimit", () => {
  it("falls back to the default when the variable is absent", async () => {
    const demoAiDailyLimit = await loadDemoAiDailyLimit();

    setLimit(undefined);
    assert.equal(demoAiDailyLimit(), DEFAULT_LIMIT);
  });

  // The defect this covers: Number("") is 0, so a variable left blank silently
  // turned live demo AI off instead of reading as unset.
  it("treats a blank value as unset rather than as zero", async () => {
    const demoAiDailyLimit = await loadDemoAiDailyLimit();

    for (const blank of ["", "   ", "\t\n"]) {
      setLimit(blank);
      assert.equal(demoAiDailyLimit(), DEFAULT_LIMIT);
    }
  });

  it("treats an unparseable value as unset", async () => {
    const demoAiDailyLimit = await loadDemoAiDailyLimit();

    for (const junk of ["twenty", "1e", "NaN", "--5"]) {
      setLimit(junk);
      assert.equal(demoAiDailyLimit(), DEFAULT_LIMIT);
    }
  });

  it("treats a negative value as unset", async () => {
    const demoAiDailyLimit = await loadDemoAiDailyLimit();

    setLimit("-1");
    assert.equal(demoAiDailyLimit(), DEFAULT_LIMIT);
  });

  // Deliberately not folded in with the unset cases. An operator who writes 0 is
  // asking for no spend, and replacing that with the default of 20 would spend
  // money they asked not to spend.
  it("honours an explicit zero, because that is how live AI is switched off", async () => {
    const demoAiDailyLimit = await loadDemoAiDailyLimit();

    setLimit("0");
    assert.equal(demoAiDailyLimit(), 0);
  });

  it("reads a configured positive limit, whitespace and all", async () => {
    const demoAiDailyLimit = await loadDemoAiDailyLimit();

    setLimit("5");
    assert.equal(demoAiDailyLimit(), 5);

    setLimit("  7  ");
    assert.equal(demoAiDailyLimit(), 7);
  });

  it("floors a fractional limit to whole briefs", async () => {
    const demoAiDailyLimit = await loadDemoAiDailyLimit();

    setLimit("2.9");
    assert.equal(demoAiDailyLimit(), 2);
  });
});
