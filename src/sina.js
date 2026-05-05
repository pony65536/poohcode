/**
 * Sina Finance API wrapper — free real-time & historical stock data for A-shares.
 *
 * Uses the well-documented unofficial Sina Finance JSONP/CSV endpoints.
 * No API key required. For personal/educational use only.
 *
 * Real-time quote: https://hq.sinajs.cn/list=<prefix><code>
 *   - sh → Shanghai, sz → Shenzhen
 *   - Returns a JavaScript variable string (JSONP-like)
 *
 * Historical K-line: https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData
 *   - Query params: symbol, scale, datalen, ma
 *
 * US stocks: https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getKLineData
 */

const SINA_QUOTE_URL = "https://hq.sinajs.cn/list";
const SINA_KLINE_URL =
  "https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize stock code to Sina format (sh/sz prefix).
 * - 6xxxxx → sh, 0xxxxx/sz → sz, 3xxxxx → sz (ChiNext)
 * - If already prefixed (sh/sz), return as-is.
 */
function normalizeCode(code) {
  code = code.trim().toLowerCase();
  if (code.startsWith("sh") || code.startsWith("sz")) return code;
  // Map numeric prefix
  if (code.startsWith("6")) return `sh${code}`;
  if (code.startsWith("0") || code.startsWith("3") || code.startsWith("2")) return `sz${code}`;
  // Default to Shanghai
  return `sh${code}`;
}

/**
 * Parse the raw JSONP response from Sina real-time quote API.
 * Example:
 *   var hq_str_sh600519="贵州茅台,1570.00,1568.00,1585.00,1592.00,1565.00,1585.00,1586.00,..."
 * Fields: name, open, yestClose, current, high, low, bid, ask, volume, amount,
 *         bid1_vol, bid1, bid2_vol, bid2, ..., ask5_vol, ask5, date, time
 */
function parseQuoteResponse(raw) {
  // Extract the value string between double quotes after "="
  const match = raw.match(/="([^"]+)"/);
  if (!match) throw new Error(`Unexpected response format: ${raw.slice(0, 80)}`);

  const fields = match[1].split(",");
  if (fields.length < 32) throw new Error(`Too few fields (${fields.length}) in quote response`);

  return {
    name: fields[0],
    open: parseFloat(fields[1]),
    yesterdayClose: parseFloat(fields[2]),
    current: parseFloat(fields[3]),
    high: parseFloat(fields[4]),
    low: parseFloat(fields[5]),
    bid: parseFloat(fields[6]),
    ask: parseFloat(fields[7]),
    volume: parseInt(fields[8], 10),
    amount: parseFloat(fields[9]),
    // Bid levels (5 levels)
    bids: [
      { price: parseFloat(fields[11]), volume: parseInt(fields[10], 10) },
      { price: parseFloat(fields[13]), volume: parseInt(fields[12], 10) },
      { price: parseFloat(fields[15]), volume: parseInt(fields[14], 10) },
      { price: parseFloat(fields[17]), volume: parseInt(fields[16], 10) },
      { price: parseFloat(fields[19]), volume: parseInt(fields[18], 10) },
    ],
    // Ask levels (5 levels)
    asks: [
      { price: parseFloat(fields[21]), volume: parseInt(fields[20], 10) },
      { price: parseFloat(fields[23]), volume: parseInt(fields[22], 10) },
      { price: parseFloat(fields[25]), volume: parseInt(fields[24], 10) },
      { price: parseFloat(fields[27]), volume: parseInt(fields[26], 10) },
      { price: parseFloat(fields[29]), volume: parseInt(fields[28], 10) },
    ],
    date: fields[30],
    time: fields[31],
    // Computed
    change: parseFloat((parseFloat(fields[3]) - parseFloat(fields[2])).toFixed(2)),
    changePercent: fields[2] !== "0.000" ? parseFloat((((fields[3] - fields[2]) / fields[2]) * 100).toFixed(2)) : 0,
  };
}

// ─── Real-time quote ─────────────────────────────────────────────────────────

/**
 * Fetch real-time quote for one or more stocks.
 * @param {string|string[]} codes — Stock code(s), e.g. "600519" or ["600519", "000001"]
 * @returns {Promise<Object|Object[]>} — Single object if input was string, array otherwise
 */
export async function getQuote(codes) {
  const isSingle = typeof codes === "string";
  const codeList = isSingle ? [codes] : codes;

  // Normalize and join
  const normalized = codeList.map(normalizeCode);
  const url = `${SINA_QUOTE_URL}=${normalized.join(",")}`;

  const response = await fetch(url, {
    headers: {
      Referer: "https://finance.sina.com.cn",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Sina API HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();

  // Parse each line (one per stock)
  const lines = text.trim().split("\n");
  if (lines.length === 0) throw new Error("Empty response from Sina API");

  // Each line: var hq_str_sh600519="...";
  const results = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    return parseQuoteResponse(trimmed);
  });

  return isSingle ? results[0] : results;
}

// ─── Historical K-line ───────────────────────────────────────────────────────

/**
 * K-line scale types.
 */
export const KLINE_SCALE = {
  DAILY: 5,
  WEEKLY: 30,
  MONTHLY: 60,
};

/**
 * Fetch historical K-line data.
 * @param {string} code — Stock code, e.g. "600519"
 * @param {Object} [options]
 * @param {number} [options.scale=5] — K-line scale: 5=daily, 30=weekly, 60=monthly
 * @param {number} [options.datalen=100] — Number of data points (max ~1023)
 * @param {number} [options.ma=5] — Moving average period (0 to disable)
 * @returns {Promise<Object[]>} — Array of K-line entries
 */
export async function getKLine(code, options = {}) {
  const { scale = KLINE_SCALE.DAILY, datalen = 100, ma = 5 } = options;
  const normalized = normalizeCode(code);
  const market = normalized.startsWith("sh") ? "sh" : "sz";
  // Sina format: symbol=sh600519
  const params = new URLSearchParams({
    symbol: normalized,
    scale: String(scale),
    datalen: String(datalen),
    ma: String(ma),
  });

  const url = `${SINA_KLINE_URL}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Referer: "https://finance.sina.com.cn",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Sina K-line API HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();

  // Response is JSON array
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse K-line response: ${text.slice(0, 100)}`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`Unexpected K-line response format: ${text.slice(0, 100)}`);
  }

  return data.map((item) => ({
    date: item.day || item.date,
    open: parseFloat(item.open),
    high: parseFloat(item.high),
    low: parseFloat(item.low),
    close: parseFloat(item.close),
    volume: parseInt(item.volume, 10),
    ma: item.ma ? parseFloat(item.ma) : undefined,
  }));
}

// ─── Format quote for display ────────────────────────────────────────────────

/**
 * Format a quote object into a human-readable string.
 */
export function formatQuote(quote) {
  const sign = quote.change >= 0 ? "+" : "";
  return `${quote.name}  ${quote.current.toFixed(2)}  ${sign}${quote.change.toFixed(2)} (${sign}${quote.changePercent.toFixed(2)}%)  H:${quote.high.toFixed(2)} L:${quote.low.toFixed(2)} O:${quote.open.toFixed(2)}  ${quote.date} ${quote.time}`;
}

// ─── Tool definition for agent ────────────────────────────────────────────────

/**
 * Tool definition for use with the agent system.
 * The agent can call this tool to look up stock quotes.
 */
export const sinaQuoteTool = {
  type: "function",
  function: {
    name: "get_stock_quote",
    description: "获取A股实时行情数据（新浪财经）。输入股票代码，返回当前价格、涨跌幅、最高/最低价等。",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "股票代码，如 600519（贵州茅台）或 000001（平安银行）",
        },
      },
      required: ["code"],
    },
  },
};
