import { describe, it, expect } from "vitest";
import { resolveSafePath, SandboxError } from "../src/sandbox.js";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("resolveSafePath", () => {
  it("resolves a relative path within workspace", () => {
    const cwd = process.cwd();
    const result = resolveSafePath("src", cwd);
    expect(result).toBe(resolve(cwd, "src"));
  });

  it("resolves an absolute path within workspace", () => {
    const cwd = process.cwd();
    const result = resolveSafePath(resolve(cwd, "src"), cwd);
    expect(result).toBe(resolve(cwd, "src"));
  });

  it("throws when path escapes workspace via ..", () => {
    const cwd = process.cwd();
    expect(() => resolveSafePath("../../../etc/passwd", cwd)).toThrow(SandboxError);
  });

  it("throws when absolute path is outside workspace", () => {
    const cwd = process.cwd();
    const outside = process.platform === "win32" ? "C:\\Windows\\System32" : "/etc";
    expect(() => resolveSafePath(outside, cwd)).toThrow(SandboxError);
  });

  it("normalizes redundant .. and . in safe paths", () => {
    const cwd = process.cwd();
    const result = resolveSafePath("src/../src/./agent.js", cwd);
    expect(result).toBe(resolve(cwd, "src/agent.js"));
  });
});

describe("SandboxError", () => {
  it("has correct name", () => {
    const err = new SandboxError("test");
    expect(err.name).toBe("SandboxError");
    expect(err.message).toContain("[Sandbox]");
  });

  it("is an instance of Error", () => {
    expect(new SandboxError("test")).toBeInstanceOf(Error);
  });
});
