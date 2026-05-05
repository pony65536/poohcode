/**
 * Telegram Bot entry point for PoohCode.
 *
 * Connects PoohCode's agent to Telegram groups via grammy.
 * Uses SQLite for persistent per-chat context storage.
 *
 * ## Context organization strategy
 *
 * ### Chat isolation
 * Each Telegram chat (private or group) gets its own SQLite row.
 * In group chats, **reply threads** (message_thread_id) are treated as
 * independent conversations — each thread has its own message history.
 *
 * ### Conversation structure
 * Messages are stored as a JSON array in the `messages` column.
 * Each message is an OpenAI-format object { role, content, tool_calls? }.
 * The agent's runAgent() uses the existing context management (src/context.js)
 * which handles token budget, summarization, and tool result truncation.
 *
 * ### SQLite schema
 *   CREATE TABLE IF NOT EXISTS conversations (
 *     chat_id     INTEGER NOT NULL,
 *     thread_id   INTEGER DEFAULT 0,   -- 0 = main chat, >0 = reply thread
 *     lang        TEXT DEFAULT 'zh',
 *     messages    TEXT DEFAULT '[]',    -- JSON array of OpenAI messages
 *     created_at  TEXT DEFAULT (datetime('now')),
 *     updated_at  TEXT DEFAULT (datetime('now')),
 *     PRIMARY KEY (chat_id, thread_id)
 *   );
 *
 * Environment variables:
 *   TELEGRAM_BOT_TOKEN   — Bot token from @BotFather
 *   TELEGRAM_ADMIN_IDS   — Comma-separated user IDs allowed in groups
 *   DEEPSEEK_API_KEY     — DeepSeek API key (required)
 *   DEEPSEEK_MODEL       — Model name (default: deepseek-chat)
 *   POOHCODE_LOG         — Set to "false" to suppress tool logs
 *
 * Usage:
 *   npm run telegram
 *   # or: node src/telegram.js
 */

import "dotenv/config";
import { Bot, InlineKeyboard } from "grammy";
import Database from "better-sqlite3";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import { runAgent } from "./agent.js";
import { setLang, getLang, LANGUAGES, t } from "./lang.js";

// ─── Configuration ──────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN environment variable is not set.");
  console.error("   Get one from https://t.me/BotFather and add it to your .env file.");
  process.exit(1);
}

const ADMIN_IDS = new Set(
  (process.env.TELEGRAM_ADMIN_IDS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(Number)
);

const MAX_MESSAGE_LENGTH = 4000;
const MAX_TOOL_RESULT_CHARS = 8000;
const MAX_CONTEXT_TOKENS = 90000;
const MAX_CONVERSATION_MESSAGES = 200; // safety limit per chat/thread

// ─── SQLite setup ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(join(DATA_DIR, "telegram.db"));

// Enable WAL mode for better concurrent access
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    chat_id     INTEGER NOT NULL,
    thread_id   INTEGER DEFAULT 0,
    lang        TEXT DEFAULT 'zh',
    messages    TEXT DEFAULT '[]',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (chat_id, thread_id)
  )
`);

// Prepared statements
const stmt = {
  getConversation: db.prepare(
    "SELECT lang, messages, created_at FROM conversations WHERE chat_id = ? AND thread_id = ?"
  ),
  upsertConversation: db.prepare(`
    INSERT INTO conversations (chat_id, thread_id, lang, messages, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id, thread_id) DO UPDATE SET
      lang = COALESCE(EXCLUDED.lang, lang),
      messages = EXCLUDED.messages,
      updated_at = datetime('now')
  `),
  updateLang: db.prepare(`
    INSERT INTO conversations (chat_id, thread_id, lang, messages, updated_at)
    VALUES (?, ?, ?, '[]', datetime('now'))
    ON CONFLICT(chat_id, thread_id) DO UPDATE SET
      lang = EXCLUDED.lang,
      updated_at = datetime('now')
  `),
  deleteConversation: db.prepare(
    "DELETE FROM conversations WHERE chat_id = ? AND thread_id = ?"
  ),
};

// ─── Context helpers ────────────────────────────────────────────────────────

/**
 * Get or create a conversation context for (chat_id, thread_id).
 *
 * @param {number} chatId
 * @param {number} [threadId=0] - 0 = main chat, >0 = reply thread
 * @returns {{ messages: object[], lang: string }}
 */
function getContext(chatId, threadId = 0) {
  const row = stmt.getConversation.get(chatId, threadId);
  if (!row) {
    return { messages: [], lang: "zh" };
  }
  return {
    messages: JSON.parse(row.messages || "[]"),
    lang: row.lang || "zh",
  };
}

/**
 * Save messages and lang for (chat_id, thread_id).
 */
function saveContext(chatId, threadId = 0, messages, lang) {
  // Safety limit: truncate oldest messages if too many
  let trimmed = messages;
  if (messages.length > MAX_CONVERSATION_MESSAGES) {
    const keepSystem = messages[0]?.role === "system" ? 1 : 0;
    trimmed = [
      ...messages.slice(0, keepSystem),
      ...messages.slice(-MAX_CONVERSATION_MESSAGES + keepSystem),
    ];
  }
  stmt.upsertConversation.run(chatId, threadId, lang, JSON.stringify(trimmed));
}

/**
 * Clear the conversation for (chat_id, thread_id).
 */
function clearContext(chatId, threadId = 0) {
  stmt.deleteConversation.run(chatId, threadId);
}

// ─── Helper functions ───────────────────────────────────────────────────────

function* splitMessage(text, maxLen = MAX_MESSAGE_LENGTH) {
  while (text.length > maxLen) {
    let splitAt = text.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    yield text.slice(0, splitAt);
    text = text.slice(splitAt).trimStart();
  }
  if (text.length > 0) yield text;
}

// ─── Bot setup ──────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);

// ─── Auth check ─────────────────────────────────────────────────────────────

function isUserAllowed(ctx) {
  const chatId = ctx.chat?.id;
  const userId = ctx.from?.id;
  if (!chatId || !userId) return false;

  // Always allow private chats
  if (ctx.chat.type === "private") return true;

  // For groups: only allow if user is in ADMIN_IDS
  if (ADMIN_IDS.size > 0 && ADMIN_IDS.has(userId)) return true;

  // Deny unauthorized users silently
  return false;
}

// ─── Commands ───────────────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  // Always respond to /start (it's a standard bot command)
  const chatId = ctx.chat.id;
  const threadId = ctx.message?.message_thread_id || 0;

  await ctx.reply(
    "🤖 *PoohCode Agent*\n\n" +
    "I'm a coding agent powered by DeepSeek. I can read/write files, run commands, search code, and more.\n\n" +
    "Commands:\n" +
    "/language  — Switch language\n" +
    "/clear     — Reset conversation for this chat/thread\n" +
    "/stats     — Show session cost\n" +
    "/start     — Show this message\n\n" +
    "Just send me a message and I'll help you code!"
  );
});

bot.command("clear", async (ctx) => {
  if (!isUserAllowed(ctx)) return;

  const chatId = ctx.chat.id;
  const threadId = ctx.message?.message_thread_id || 0;
  clearContext(chatId, threadId);

  await ctx.reply("🗑 Conversation cleared.");
});

bot.command("language", async (ctx) => {
  if (!isUserAllowed(ctx)) return;

  const chatId = ctx.chat.id;
  const threadId = ctx.message?.message_thread_id || 0;
  const ctx_ = getContext(chatId, threadId);
  const currentLang = ctx_.lang;

  const keyboard = new InlineKeyboard();
  for (const lang of LANGUAGES) {
    const marker = lang.code === currentLang ? " ●" : "";
    keyboard.text(lang.name + marker, `lang_${lang.code}`);
  }

  // Re-arrange keyboard in rows of 2
  const buttons = keyboard.inline_keyboard.flat();
  const rows = [];
  for (let i = 0; i < buttons.length; i += 2) {
    rows.push(buttons.slice(i, i + 2));
  }
  const arranged = InlineKeyboard.from(rows);

  await ctx.reply("🌐 Choose your language / 选择语言:", {
    reply_markup: arranged,
  });
});

// ─── Inline keyboard callbacks ───────────────────────────────────────────────

// Language selection
bot.callbackQuery(/^lang_(.+)$/, async (ctx) => {
  const code = ctx.match[1];
  const chatId = ctx.chat.id;
  const threadId = ctx.callbackQuery.message?.message_thread_id || 0;

  const lang = LANGUAGES.find(l => l.code === code);
  if (!lang) {
    await ctx.answerCallbackQuery({ text: "Invalid language." });
    return;
  }

  // Save the language preference
  stmt.updateLang.run(chatId, threadId, code);
  setLang(code);

  await ctx.editMessageText(`✅ Language switched to ${lang.name}`);
  await ctx.answerCallbackQuery();
});

// Confirmation buttons
// Format: confirm_{allow|allow_all|deny}_{randomId}
const pendingConfirmations = new Map();

bot.callbackQuery(/^confirm_(allow|allow_all|deny)_(.+)$/, async (ctx) => {
  const action = ctx.match[1];
  const id = ctx.match[2];
  const chatId = ctx.chat.id;

  const pending = pendingConfirmations.get(id);
  if (!pending || pending.chatId !== chatId) {
    await ctx.answerCallbackQuery({ text: "This confirmation has expired." });
    return;
  }

  const resultText = action === "allow"
    ? "✓ Allowed."
    : action === "allow_all"
    ? "✓✓ Always allowed (this session)."
    : "✗ Denied.";

  await ctx.editMessageText(
    ctx.callbackQuery.message.text + "\n\n" + resultText,
    { reply_markup: undefined }
  );

  pending.resolve(action);
  pendingConfirmations.delete(id);
  await ctx.answerCallbackQuery();
});

// ─── Message handler ────────────────────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  if (!isUserAllowed(ctx)) return;

  const chatId = ctx.chat.id;
  const threadId = ctx.message.message_thread_id || 0;
  const text = ctx.message.text;

  // Skip commands handled by bot.command()
  if (text.startsWith("/")) return;

  // Ensure the bot only responds when explicitly addressed in group chats:
  // - Private chat: always respond
  // - Group chat: only respond if bot username is mentioned, or it's a reply
  //   to a bot message, or the message is in a reply thread (message_thread_id)
  if (ctx.chat.type !== "private") {
    const botUsername = (await bot.api.getMe()).username.toLowerCase();
    const isMentioned = text.toLowerCase().includes("@" + botUsername);
    const isReplyToBot = ctx.message.reply_to_message?.from?.id === ctx.me.id;
    const isInThread = !!threadId;

    if (!isMentioned && !isReplyToBot && !isInThread) {
      return; // don't respond to random group messages
    }
  }

  // Get persisted context
  const ctx_ = getContext(chatId, threadId);
  const { messages: history, lang } = ctx_;

  // Set language for this interaction
  setLang(lang);

  // Send typing indicator
  await ctx.api.sendChatAction(chatId, "typing");

  // "Thinking..." placeholder
  const statusMsg = await ctx.reply("💭 Thinking...");

  try {
    let answerText = "";
    let thinkingBuffer = "";
    let lastThinkUpdate = Date.now();

    await runAgent(text, history, {
      onContent(chunk) {
        answerText += chunk;
      },
      onThinking(chunk) {
        // Buffer thinking and periodically update the status message
        thinkingBuffer += chunk;
        const now = Date.now();
        if (now - lastThinkUpdate > 5000) {
          lastThinkUpdate = now;
          const preview = thinkingBuffer.slice(-80).replace(/\n/g, " ");
          ctx.api.editMessageText(
            chatId,
            statusMsg.message_id,
            `💭 Thinking...\n\`${preview}\``
          ).catch(() => {});
        }
      },
      onDone(messages) {
        // Persist the full context to SQLite.
        // The agent's messages array includes the system prompt,
        // so we strip it before saving (we don't need to persist
        // the system prompt — it's reconstructed on each load).
        const history = messages.filter(m => m.role !== "system");
        if (saveContext) {
          saveContext(chatId, threadId, history, lang);
        }
      },
      onToolStartBatch() {
        // Update status to show tools are running
        ctx.api.editMessageText(
          chatId,
          statusMsg.message_id,
          "🔧 Running tools..."
        ).catch(() => {});
      },
      onToolEndBatch() {
        // Tools done
        ctx.api.sendChatAction(chatId, "typing").catch(() => {});
      },
      async onConfirm(toolName, summary) {
        // Build inline keyboard for confirmation
        const confirmId = `${chatId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const keyboard = new InlineKeyboard()
          .text("✓ Allow", `confirm_allow_${confirmId}`)
          .text("✓✓ Always Allow", `confirm_allow_all_${confirmId}`)
          .text("✗ Deny", `confirm_deny_${confirmId}`);

        await ctx.reply(
          `🔍 *Confirm: ${toolName}*\n\`\`\`\n${summary.slice(0, 1500)}\n\`\`\``,
          { reply_markup: keyboard, parse_mode: "Markdown" }
        );

        return new Promise((resolve) => {
          pendingConfirmations.set(confirmId, { resolve, chatId });
          // Timeout after 120 seconds
          setTimeout(() => {
            if (pendingConfirmations.has(confirmId)) {
              pendingConfirmations.delete(confirmId);
              resolve("deny");
            }
          }, 120_000);
        });
      },
    });

    // Send the answer, splitting if needed
    if (answerText.trim()) {
      await ctx.api.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

      for (const part of splitMessage(answerText)) {
        await ctx.reply(part);
      }
    } else {
      await ctx.api.editMessageText(
        chatId,
        statusMsg.message_id,
        "✅ Done (no text response)."
      ).catch(() => {});
    }
  } catch (err) {
    await ctx.api.editMessageText(
      chatId,
      statusMsg.message_id,
      `❌ Error: ${err.message.slice(0, 500)}`
    ).catch(() => {
      ctx.reply(`❌ Error: ${err.message.slice(0, 500)}`).catch(() => {});
    });
  }
});

// ─── Error handler ──────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error("Bot error:", err);
});

// ─── Start the bot ──────────────────────────────────────────────────────────

async function startBot() {
  console.log("🤖 PoohCode Telegram Bot is starting...");
  console.log(`   Bot username: @${(await bot.api.getMe()).username}`);

  // Remove webhook if any, then start polling
  await bot.api.deleteWebhook().catch(() => {});
  bot.start({
    onStart: (info) => {
      console.log(`   ✅ Bot started! Username: @${info.username}`);
      console.log("   Press Ctrl+C to stop.");
    },
  });
}

startBot().catch((err) => {
  console.error("❌ Failed to start bot:", err);
  process.exit(1);
});

// ─── Graceful shutdown ──────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  console.log("\n🛑 Stopping bot...");
  db.close();
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Stopping bot...");
  db.close();
  await bot.stop();
  process.exit(0);
});
