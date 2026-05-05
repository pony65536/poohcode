export const definition = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current information. Use this when you need up-to-date facts, recent news, or information beyond your knowledge cutoff.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query string.",
        },
      },
      required: ["query"],
    },
  },
};

export async function execute(args) {
  const query = args.query;
  const now = new Date().toISOString();
  const searchQuery = `[Current time: ${now}] ${query}`;

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query: searchQuery,
      search_depth: "basic",
      max_results: 5,
    }),
  });

  if (!response.ok) {
    return `Search failed: ${response.status} ${response.statusText}`;
  }

  const data = await response.json();
  const results = (data.results || []).map((r, i) =>
    `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`
  );
  return results.length > 0
    ? results.join("\n\n")
    : "No results found.";
}
