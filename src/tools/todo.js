export const definition = {
  type: "function",
  function: {
    name: "todo_write",
    description: "Create and manage a structured task list for your current coding session. Use this to plan complex tasks: break down the user's request into sub-tasks, track progress, and mark items as done. Always create a plan BEFORE starting to make changes. The task list helps you stay organized and shows the user what you're doing.",
    parameters: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "integer", description: "Task number (1-based)." },
              title: { type: "string", description: "Brief task description." },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed"],
                description: "Current status. Only ONE task should be in_progress at a time.",
              },
            },
            required: ["id", "title", "status"],
          },
          description: "The full task list, including any previously created tasks with updated statuses.",
        },
      },
      required: ["tasks"],
    },
  },
};

export async function execute(args) {
  const { tasks } = args;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return "Error: tasks must be a non-empty array.";
  }

  const lines = [];
  for (const t of tasks) {
    const icon = t.status === "completed" ? "✓" :
                 t.status === "in_progress" ? "→" : "·";
    lines.push(`  ${icon} [${t.id}] ${t.title}`);
  }

  const pending = tasks.filter(t => t.status === "pending").length;
  const inProgress = tasks.filter(t => t.status === "in_progress").length;
  const completed = tasks.filter(t => t.status === "completed").length;

  const summary = `Todo list: ${completed} done, ${inProgress} in progress, ${pending} pending.\n\n${lines.join("\n")}`;
  return summary;
}
