import { describe, it, expect } from "vitest";
import { countTokens, estimateMessagesTokens, splitRounds } from "../src/context.js";

describe("countTokens", () => {
  it("returns 0 for empty/null/undefined", () => {
    expect(countTokens("")).toBe(0);
    expect(countTokens(null)).toBe(0);
    expect(countTokens(undefined)).toBe(0);
  });

  it("returns exact count for English text", () => {
    // "hello world" = 2 tokens with cl100k_base
    expect(countTokens("hello world")).toBe(2);
  });

  it("counts CJK text correctly", () => {
    // CJK chars are typically 1-2 tokens each
    const tokens = countTokens("这是一个测试句子");
    expect(tokens).toBeGreaterThan(0);
  });

  it("handles mixed CJK and English", () => {
    const tokens = countTokens("hello 世界 foo 测试");
    expect(tokens).toBeGreaterThan(0);
  });

  it("returns integer", () => {
    expect(Number.isInteger(countTokens("test"))).toBe(true);
  });
});

describe("estimateMessagesTokens", () => {
  it("returns 0 for empty array", () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it("counts tokens for each message", () => {
    const msgs = [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ];
    const tokens = estimateMessagesTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });

  it("includes tool_call overhead", () => {
    const msgs = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "1", type: "function", function: { name: "read_file", arguments: '{"path":"test"}' } }],
      },
    ];
    const tokens = estimateMessagesTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("splitRounds", () => {
  it("splits messages by user role", () => {
    const msgs = [
      { role: "user", content: "task 1" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "task 2" },
      { role: "assistant", content: "done" },
    ];
    const rounds = splitRounds(msgs);
    expect(rounds).toHaveLength(2);
    expect(rounds[0][0].content).toBe("task 1");
    expect(rounds[1][0].content).toBe("task 2");
  });

  it("returns single round when only one user message", () => {
    const msgs = [
      { role: "user", content: "task" },
      { role: "assistant", content: "ok" },
    ];
    const rounds = splitRounds(msgs);
    expect(rounds).toHaveLength(1);
  });

  it("handles empty array", () => {
    expect(splitRounds([])).toHaveLength(0);
  });
});
