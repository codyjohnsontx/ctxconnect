import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redactProviderSecrets } from "../src/lib/ai/ops-brief";

// These cover behaviour that was decided deliberately: credentials must never
// reach a log line or a ProductEvent row, and diagnostic text must survive so a
// recorded failure stays traceable with the provider.

describe("redactProviderSecrets", () => {
  describe("credential masking", () => {
    it("masks an sk- key", () => {
      const result = redactProviderSecrets("Incorrect API key provided: sk-proj-abc123DEF456ghi789.");
      assert.equal(result, "Incorrect API key provided: sk-[redacted].");
      assert.ok(!result.includes("abc123DEF456ghi789"));
    });

    it("masks the masked form a provider echoes back", () => {
      const result = redactProviderSecrets("sk-inval*********************************test");
      assert.equal(result, "sk-[redacted]");
    });

    it("masks a Bearer token but keeps the scheme", () => {
      const result = redactProviderSecrets("Authorization: Bearer abc123def456ghi789jkl012mno345pq");
      assert.equal(result, "Authorization: Bearer [redacted]");
    });

    it("masks a Bearer token case-insensitively", () => {
      assert.equal(redactProviderSecrets("bearer SomeOpaqueValue"), "bearer [redacted]");
    });

    it("redacts a long opaque token with no recognisable prefix", () => {
      const token = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
      assert.equal(token.length, 32);
      assert.equal(redactProviderSecrets(`token ${token} rejected`), "token [redacted] rejected");
    });

    it("masks every credential in a message, not only the first", () => {
      const result = redactProviderSecrets("tried sk-one111 then sk-two222");
      assert.equal(result, "tried sk-[redacted] then sk-[redacted]");
    });
  });

  describe("request id preservation", () => {
    it("keeps a req_ prefixed request id", () => {
      const message = "Rate limit reached. req_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps a request- prefixed id", () => {
      const message = "failed request-00112233445566778899aabbccddeeff";
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps an id introduced by a request_id label", () => {
      const message = 'request_id: 00112233445566778899aabbccddeeff';
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps an id behind a quoted JSON key with an unquoted value", () => {
      const message = '"request_id": 00112233445566778899aabbccddeeff';
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps a Request ID label written with a capital and a space", () => {
      const message = "Request ID: 00112233445566778899aabbccddeeff";
      assert.equal(redactProviderSecrets(message), message);
    });

    it("redacts a labelled id whose value is quoted, which is the conservative edge", () => {
      // Pinned deliberately rather than treated as a bug. The label heuristic
      // requires the separator to be the last thing before the token, so once the
      // value is quoted the token falls through and is redacted. Erring toward
      // redaction is the safe direction, and the primary path does not depend on
      // the label at all: a real OpenAI id carries its own `req_` prefix and
      // survives quoting, which the cases above cover. Written down so a later
      // change to the pattern has to move this on purpose.
      assert.equal(
        redactProviderSecrets('{"request_id": "00112233445566778899aabbccddeeff"}'),
        '{"request_id": "[redacted]"}',
      );
      assert.equal(
        redactProviderSecrets('req_00112233445566778899aabbccddeeff quoted as "req_00112233445566778899aabbccddeeff"'),
        'req_00112233445566778899aabbccddeeff quoted as "req_00112233445566778899aabbccddeeff"',
      );
    });

    it("still masks a key that appears alongside a preserved request id", () => {
      const result = redactProviderSecrets(
        "401 Incorrect API key provided: sk-secretvalue. req_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
      );
      assert.ok(result.includes("req_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"));
      assert.ok(!result.includes("secretvalue"));
    });
  });

  describe("ordinary text is left alone", () => {
    it("keeps prose containing no credential", () => {
      const message = "Request timed out after 30000ms while calling gpt-4.1-mini.";
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps a long run of words even past the token length threshold", () => {
      const message =
        "The upstream service returned an unexpected empty completion for this conversation";
      assert.ok(message.length > 32);
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps a long all-letter token, which cannot be a mixed-charset credential", () => {
      const message = "reason ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh";
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps a long all-digit token", () => {
      const message = "at 12345678901234567890123456789012 ms";
      assert.equal(redactProviderSecrets(message), message);
    });

    it("keeps a token shorter than the redaction threshold", () => {
      const message = "code a1b2c3d4e5f6g7h8";
      assert.equal(redactProviderSecrets(message), message);
    });

    it("returns an empty string unchanged", () => {
      assert.equal(redactProviderSecrets(""), "");
    });
  });
});
