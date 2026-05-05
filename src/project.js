import { existsSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

/**
 * Scan the project root and detect key facts about the project.
 * Called once at startup; the result is injected into the system prompt.
 */
export function detectProject(workspace) {
  const root = resolve(workspace);
  const info = {
    type: null,
    language: null,
    packageManager: null,
    testFramework: null,
    lintTools: [],
    framework: null,
    buildTool: null,
    hasGit: false,
    gitBranch: null,
    entryFile: null,
    summary: "",
  };

  // ── Package.json (Node.js) ────────────────────────────────────────────
  let pkg = null;
  if (existsSync(resolve(root, "package.json"))) {
    try {
      pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
    } catch { /* ignore */ }
  }

  if (pkg) {
    info.type = "Node.js";
    info.language = pkg.type === "module" ? "JavaScript (ESM)" : "JavaScript";

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const scripts = pkg.scripts || {};

    // Package manager
    if (existsSync(resolve(root, "yarn.lock"))) info.packageManager = "yarn";
    else if (existsSync(resolve(root, "pnpm-lock.yaml"))) info.packageManager = "pnpm";
    else info.packageManager = "npm";

    // Test framework
    if (deps.vitest) info.testFramework = "vitest";
    else if (deps.jest) info.testFramework = "jest";
    else if (deps.mocha) info.testFramework = "mocha";
    else if (deps["@playwright/test"]) info.testFramework = "playwright";
    if (scripts.test && !info.testFramework) info.testFramework = `npm run test (${scripts.test})`;

    // Linting
    if (deps.eslint || existsSync(resolve(root, ".eslintrc.js")) || existsSync(resolve(root, ".eslintrc.json")) || existsSync(resolve(root, "eslint.config.js"))) {
      info.lintTools.push("eslint");
    }
    if (deps.prettier || existsSync(resolve(root, ".prettierrc"))) {
      info.lintTools.push("prettier");
    }
    if (deps.typescript || existsSync(resolve(root, "tsconfig.json"))) {
      info.language = "TypeScript";
      info.lintTools.push("tsc");
    }

    // Framework
    if (deps.next) info.framework = "Next.js";
    else if (deps.react && deps["react-scripts"]) info.framework = "Create React App";
    else if (deps.react) info.framework = "React";
    else if (deps.vue) info.framework = "Vue";
    else if (deps.express) info.framework = "Express";
    else if (deps.fastify) info.framework = "Fastify";
    else if (deps["@nestjs/core"]) info.framework = "NestJS";

    // Build tool
    if (deps.vite) info.buildTool = "vite";
    else if (deps.webpack) info.buildTool = "webpack";
    else if (deps.turbopack) info.buildTool = "turbopack";
  }

  // ── Python ────────────────────────────────────────────────────────────
  if (!info.type) {
    if (existsSync(resolve(root, "pyproject.toml"))) {
      info.type = "Python";
      info.language = "Python";
      info.buildTool = "pyproject.toml";
    } else if (existsSync(resolve(root, "setup.py")) || existsSync(resolve(root, "setup.cfg"))) {
      info.type = "Python";
      info.language = "Python";
    }
    if (info.type === "Python") {
      if (existsSync(resolve(root, "tox.ini"))) info.testFramework = "tox";
      else if (existsSync(resolve(root, "pytest.ini"))) info.testFramework = "pytest";
      if (existsSync(resolve(root, ".ruff.toml"))) info.lintTools.push("ruff");
      if (existsSync(resolve(root, ".flake8"))) info.lintTools.push("flake8");
    }
  }

  // ── Go ────────────────────────────────────────────────────────────────
  if (!info.type && existsSync(resolve(root, "go.mod"))) {
    info.type = "Go";
    info.language = "Go";
    info.testFramework = "go test";
    info.buildTool = "go build";
  }

  // ── Rust ──────────────────────────────────────────────────────────────
  if (!info.type && existsSync(resolve(root, "Cargo.toml"))) {
    info.type = "Rust";
    info.language = "Rust";
    info.testFramework = "cargo test";
    info.buildTool = "cargo build";
  }

  // ── Common entry files ────────────────────────────────────────────────
  for (const f of ["index.js", "index.ts", "main.js", "main.ts", "app.js", "server.js", "src/index.js", "src/main.js"]) {
    if (existsSync(resolve(root, f))) {
      info.entryFile = f;
      break;
    }
  }

  // ── Git ───────────────────────────────────────────────────────────────
  if (existsSync(resolve(root, ".git"))) {
    info.hasGit = true;
  }

  // ── Build summary ─────────────────────────────────────────────────────
  const parts = [];
  if (info.type) {
    parts.push(`${info.type} project`);
    if (info.language) parts[0] += ` (${info.language})`;
  }
  if (info.framework) parts.push(`Framework: ${info.framework}`);
  if (info.packageManager) parts.push(`PM: ${info.packageManager}`);
  if (info.testFramework) parts.push(`Tests: ${info.testFramework}`);
  if (info.lintTools.length > 0) parts.push(`Lint: ${info.lintTools.join(", ")}`);
  if (info.hasGit) parts.push("Git: yes");
  if (info.entryFile) parts.push(`Entry: ${info.entryFile}`);
  info.summary = parts.join(" | ") || "Unknown project type";

  return info;
}
