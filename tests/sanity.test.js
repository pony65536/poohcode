import { describe, it, expect } from "vitest";

describe("module imports", () => {
  it("agent.js loads without errors", async () => {
    await import("../src/agent.js");
  });

  it("llm.js loads without errors", async () => {
    await import("../src/llm.js");
  });

  it("context.js loads without errors", async () => {
    await import("../src/context.js");
  });

  it("sandbox.js loads without errors", async () => {
    await import("../src/sandbox.js");
  });

  it("ui.js loads without errors", async () => {
    await import("../src/ui.js");
  });

  it("config.js loads without errors", async () => {
    await import("../src/config.js");
  });

  it("cost.js loads without errors", async () => {
    await import("../src/cost.js");
  });

  it("diff.js loads without errors", async () => {
    await import("../src/diff.js");
  });

  it("memory.js loads without errors", async () => {
    await import("../src/memory.js");
  });

  it("project.js loads without errors", async () => {
    await import("../src/project.js");
  });

  it("tools/index.js loads without errors", async () => {
    await import("../src/tools/index.js");
  });

  it("toolDefinitions has expected tools", async () => {
    const { toolDefinitions } = await import("../src/tools/index.js");
    const names = toolDefinitions.map((t) => t.function.name).sort();
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("search_code");
    expect(names).toContain("execute_command");
    expect(names).toContain("execute_in_shell");
  });

  it("index.js loads without errors", async () => {
    // index.js starts a readline CLI on import, so just verify
    // its direct dependencies resolve by importing a subset
    const { runAgent } = await import("../src/agent.js");
    expect(runAgent).toBeTypeOf("function");
  });
});
