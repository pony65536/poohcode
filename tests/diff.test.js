import { describe, it, expect } from "vitest";
import { unifiedDiff } from "../src/diff.js";

describe("unifiedDiff", () => {
  it("returns no-changes message when content is identical", () => {
    const result = unifiedDiff("hello\nworld", "hello\nworld", "test.txt");
    expect(result).toContain("no changes");
  });

  it("shows a single line change", () => {
    const result = unifiedDiff("line1\nline2\nline3", "line1\nCHANGED\nline3", "f.txt");
    expect(result).toContain("-line2");
    expect(result).toContain("+CHANGED");
    expect(result).toContain("line(s) changed");
  });

  it("shows added lines", () => {
    const result = unifiedDiff("line1\nline2", "line0\nline1\nline2", "f.txt");
    expect(result).toContain("+line0");
    expect(result).toContain("added");
  });

  it("shows removed lines", () => {
    const result = unifiedDiff("line1\nline2\nline3", "line3", "f.txt");
    expect(result).toContain("-line1");
    expect(result).toContain("-line2");
    expect(result).toContain("removed");
  });

  it("includes context lines before the change", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const oldStr = lines.join("\n");
    const newLines = [...lines];
    newLines[7] = "CHANGED";
    const result = unifiedDiff(oldStr, newLines.join("\n"), "f.txt");
    expect(result).toContain("line4");
    expect(result).toContain("line5");
    expect(result).toContain("line6");
  });

  it("includes the file path in the header", () => {
    const result = unifiedDiff("a", "b", "src/app.js");
    expect(result).toContain("a/src/app.js");
    expect(result).toContain("b/src/app.js");
  });
});
