import * as listDirectory from "./list_directory.js";
import * as readFile from "./read_file.js";
import * as writeFile from "./write_file.js";
import * as editFile from "./edit_file.js";
import * as webSearch from "./web_search.js";
import * as executeCommand from "./execute_command.js";
import * as executeInShell from "./execute_in_shell.js";
import * as searchCode from "./search_code.js";
import * as git from "./git.js";
import * as todoWrite from "./todo.js";
import * as runTests from "./run_tests.js";
import * as remember from "./remember.js";

const tools = [
  listDirectory,
  readFile,
  writeFile,
  editFile,
  webSearch,
  executeCommand,
  executeInShell,
  searchCode,
  git,
  todoWrite,
  runTests,
  remember,
];

export const toolDefinitions = tools.map((t) => t.definition);

const executorMap = Object.fromEntries(
  tools.map((t) => [t.definition.function.name, t.execute])
);

export async function executeTool(name, args) {
  const fn = executorMap[name];
  if (!fn) return `Unknown tool: ${name}`;
  return fn(args);
}
