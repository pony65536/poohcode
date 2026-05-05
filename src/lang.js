/**
 * src/lang.js — Internationalization dictionary
 *
 * Supported languages:
 *   zh  Chinese (default)
 *   en  English
 *   fr  French
 *   it  Italian
 *   de  German
 *   ru  Russian
 *   ja  Japanese
 *   ko  Korean
 *
 * Usage: set process.env.POOHCODE_LANG to one of the codes above,
 *        or use the /language command at runtime.
 */

// ─── Language metadata ───────────────────────────────────────────────────────

export const LANGUAGES = [
  { code: "zh", name: "中文", nameEn: "Chinese" },
  { code: "en", name: "English", nameEn: "English" },
  { code: "fr", name: "Français", nameEn: "French" },
  { code: "it", name: "Italiano", nameEn: "Italian" },
  { code: "de", name: "Deutsch", nameEn: "German" },
  { code: "ru", name: "Русский", nameEn: "Russian" },
  { code: "ja", name: "日本語", nameEn: "Japanese" },
  { code: "ko", name: "한국어", nameEn: "Korean" },
];

// ─── Current language (read from env or stored preference) ────────────────────

let _currentLang = process.env.POOHCODE_LANG || "zh";
// Validate that the set language is one we support
if (!LANGUAGES.some(l => l.code === _currentLang)) {
  _currentLang = "zh";
}

/**
 * Get the current language code.
 */
export function getLang() {
  return _currentLang;
}

/**
 * Set the current language at runtime (called by /language command).
 */
export function setLang(code) {
  if (LANGUAGES.some(l => l.code === code)) {
    _currentLang = code;
    return true;
  }
  return false;
}

/**
 * Get friendly name of the current language in that language.
 */
export function getCurrentLangName() {
  const lang = LANGUAGES.find(l => l.code === _currentLang);
  return lang ? lang.name : "中文";
}

// ─── Translation function ─────────────────────────────────────────────────────

/**
 * Translate a key. Falls back to Chinese if the key or language is missing.
 *
 * The dictionary is organized as:
 *   { key: { zh: "...", en: "...", fr: "...", ... } }
 *
 * @param {string} key - Translation key (dot-separated namespacing).
 * @param {object} [interpolations] - Optional key-value pairs for {{placeholder}} substitution.
 * @returns {string} Translated text.
 */
export function t(key, interpolations = {}) {
  const entry = dict[key];
  if (!entry) return key; // key not found, return as-is

  let text = entry[_currentLang] || entry.zh || key;
  if (!text) return key;

  // Replace {{placeholder}} patterns
  for (const [k, v] of Object.entries(interpolations)) {
    text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
  }

  return text;
}

// ─── Dictionary ───────────────────────────────────────────────────────────────

const dict = {

  // ─── Banner ────────────────────────────────────────────────────────
  "banner.subtitle": {
    zh: "   代码助手 (DeepSeek)      ",
    en: "   Coding Agent (DeepSeek)    ",
    fr: "   Agent de code (DeepSeek)   ",
    it: "   Assistente di codifica (DeepSeek) ",
    de: "   Code-Assistent (DeepSeek)  ",
    ru: "   Агент кода (DeepSeek)   ",
    ja: "   コードエージェント (DeepSeek) ",
    ko: "   코드 에이전트 (DeepSeek)   ",
  },

  // ─── Session restore ───────────────────────────────────────────────
  "session.restored": {
    zh: "✓ 恢复会话，共 {{count}} 条历史消息",
    en: "✓ Session restored with {{count}} messages from previous run.",
    fr: "✓ Session restaurée avec {{count}} messages de la session précédente.",
    it: "✓ Sessione ripristinata con {{count}} messaggi dalla sessione precedente.",
    de: "✓ Sitzung mit {{count}} Nachrichten aus vorheriger Sitzung wiederhergestellt.",
    ru: "✓ Сессия восстановлена, {{count}} сообщений из предыдущего запуска.",
    ja: "✓ セッションを復元しました（前回の {{count}} メッセージ）",
    ko: "✓ 세션이 복원되었습니다 (이전 실행의 {{count}}개 메시지)",
  },

  // ─── Usage hint ────────────────────────────────────────────────────
  "usage.exit": {
    zh: "/exit  退出",
    en: "/exit  quit",
    fr: "/exit  quitter",
    it: "/exit  esci",
    de: "/exit  beenden",
    ru: "/exit  выход",
    ja: "/exit  終了",
    ko: "/exit  종료",
  },
  "usage.clear": {
    zh: "/clear  重置对话",
    en: "/clear  reset conversation",
    fr: "/clear  réinitialiser la conversation",
    it: "/clear  resettare la conversazione",
    de: "/clear  Gespräch zurücksetzen",
    ru: "/clear  сбросить разговор",
    ja: "/clear  会話をリセット",
    ko: "/clear  대화 초기화",
  },
  "usage.language": {
    zh: "/language  切换语言",
    en: "/language  change language",
    fr: "/language  changer de langue",
    it: "/language  cambiare lingua",
    de: "/language  Sprache wechseln",
    ru: "/language  сменить язык",
    ja: "/language  言語を切り替え",
    ko: "/language  언어 전환",
  },

  // ─── Multi-line input ──────────────────────────────────────────────
  "multiline.hint": {
    zh: "  (多行输入 — 空行或 ``` 提交)",
    en: "  (multi-line input — empty line or ``` to submit)",
    fr: "  (entrée multi-ligne — ligne vide ou ``` pour soumettre)",
    it: "  (input multi-linea — linea vuota o ``` per inviare)",
    de:  "  (mehrzeilige Eingabe — leere Zeile oder ``` zum Absenden)",
    ru: "  (многострочный ввод — пустая строка или ``` для отправки)",
    ja: "  (複数行入力 — 空行または ``` で送信)",
    ko: "  (여러 줄 입력 — 빈 줄 또는 ``` 로 제출)",
  },

  // ─── Tool calls ────────────────────────────────────────────────────
  "tool.truncated": {
    zh: "字符",
    en: "chars",
    fr: "car.",
    it: "car.",
    de: "Zch.",
    ru: "сим.",
    ja: "文字",
    ko: "자",
  },

  // ─── Confirm dialog ────────────────────────────────────────────────
  "confirm.title": {
    zh: " 确认: {{name}}",
    en: " Confirm: {{name}}",
    fr: " Confirmer: {{name}}",
    it: " Conferma: {{name}}",
    de: " Bestätigen: {{name}}",
    ru: " Подтвердить: {{name}}",
    ja: " 確認: {{name}}",
    ko: " 확인: {{name}}",
  },
  "confirm.optAllow": {
    zh: "✓ 允许",
    en: "✓ Allow",
    fr: "✓ Autoriser",
    it: "✓ Consenti",
    de: "✓ Erlauben",
    ru: "✓ Разрешить",
    ja: "✓ 許可",
    ko: "✓ 허용",
  },
  "confirm.optAllowAll": {
    zh: "✓✓ 始终允许（本次会话）",
    en: "✓✓ Always allow (this session)",
    fr: "✓✓ Toujours autoriser (cette session)",
    it: "✓✓ Consenti sempre (questa sessione)",
    de: "✓✓ Immer erlauben (diese Sitzung)",
    ru: "✓✓ Всегда разрешать (эту сессию)",
    ja: "✓✓ 常に許可（このセッション）",
    ko: "✓✓ 항상 허용 (이 세션)",
  },
  "confirm.optDeny": {
    zh: "✗ 拒绝",
    en: "✗ Deny",
    fr: "✗ Refuser",
    it: "✗ Nega",
    de: "✗ Ablehnen",
    ru: "✗ Отказать",
    ja: "✗ 拒否",
    ko: "✗ 거부",
  },
  "confirm.allowed": {
    zh: " 已允许",
    en: " Allowed.",
    fr: " Autorisé.",
    it: " Consentito.",
    de: " Erlaubt.",
    ru: " Разрешено.",
    ja: " 許可しました",
    ko: " 허용됨",
  },
  "confirm.allowedAll": {
    zh: " 已允许（本会话不再询问）",
    en: " Allowed (no more prompts this session).",
    fr: " Autorisé (plus de demande cette session).",
    it: " Consentito (nessun altro prompt in questa sessione).",
    de: " Erlaubt (keine weiteren Nachfragen in dieser Sitzung).",
    ru: " Разрешено (больше не спрашивать в этой сессии).",
    ja: " 許可しました（このセッションではこれ以上確認しません）",
    ko: " 허용됨 (이 세션에서 더 이상 묻지 않음)",
  },
  "confirm.question": {
    zh: "请选择 / Choose:",
    en: "Choose:",
    fr: "Choisissez :",
    it: "Scegli:",
    de: "Auswählen:",
    ru: "Выберите:",
    ja: "選択:",
    ko: "선택:",
  },
  "confirm.denied": {
    zh: " 已跳过",
    en: " Skipped.",
    fr: " Ignoré.",
    it: " Saltato.",
    de: " Übersprungen.",
    ru: " Пропущено.",
    ja: " スキップしました",
    ko: " 건너뜀",
  },

  // ─── Exit ──────────────────────────────────────────────────────────
  "exit.saved": {
    zh: "\n  ✔ 会话已保存 ",
    en: "\n  ✔ Session saved ",
    fr: "\n  ✔ Session sauvegardée ",
    it: "\n  ✔ Sessione salvata ",
    de: "\n  ✔ Sitzung gespeichert ",
    ru: "\n  ✔ Сессия сохранена ",
    ja: "\n  ✔ セッションを保存しました ",
    ko: "\n  ✔ 세션이 저장되었습니다 ",
  },
  "exit.goodbye": {
    zh: "({{count}} 条消息)，再见！",
    en: "({{count}} messages). Goodbye!",
    fr: "({{count}} messages). Au revoir !",
    it: "({{count}} messaggi). Arrivederci!",
    de: "({{count}} Nachrichten). Tschüss!",
    ru: "({{count}} сообщений). До свидания!",
    ja: "({{count}} メッセージ)。さようなら！",
    ko: "({{count}}개 메시지). 안녕!",
  },

  // ─── Clear ─────────────────────────────────────────────────────────
  "clear.done": {
    zh: "  ✦ 对话已清空。\n",
    en: "  ✦ Conversation cleared.\n",
    fr: "  ✦ Conversation effacée.\n",
    it: "  ✦ Conversazione cancellata.\n",
    de: "  ✦ Gespräch zurückgesetzt.\n",
    ru: "  ✦ Разговор сброшен.\n",
    ja: "  ✦ 会話をクリアしました。\n",
    ko: "  ✦ 대화가 지워졌습니다.\n",
  },

  // ─── Error ─────────────────────────────────────────────────────────
  "error.prefix": {
    zh: "✗ 错误: ",
    en: "✗ Error: ",
    fr: "✗ Erreur : ",
    it: "✗ Errore: ",
    de: "✗ Fehler: ",
    ru: "✗ Ошибка: ",
    ja: "✗ エラー: ",
    ko: "✗ 오류: ",
  },

  // ─── Context trim ──────────────────────────────────────────────────
  "context.trim": {
    zh: "[CTX] 压缩约 {{pct}}% 上下文 ({{before}} → {{after}} token)",
    en: "[CTX] Trimmed ~{{pct}}% context ({{before}} → {{after}} tokens)",
    fr: "[CTX] Compression ~{{pct}}% du contexte ({{before}} → {{after}} tokens)",
    it: "[CTX] Compressione ~{{pct}}% contesto ({{before}} → {{after}} token)",
    de: "[CTX] ~{{pct}}% Kontext reduziert ({{before}} → {{after}} Token)",
    ru: "[CTX] Сжато ~{{pct}}% контекста ({{before}} → {{after}} токенов)",
    ja: "[CTX] コンテキストを約 {{pct}}% 圧縮 ({{before}} → {{after}} トークン)",
    ko: "[CTX] 컨텍스트 약 {{pct}}% 압축 ({{before}} → {{after}} 토큰)",
  },

  // ─── Shutdown ──────────────────────────────────────────────────────
  "shutdown.received": {
    zh: "⚠ 收到 {{signal}}，正在保存会话...",
    en: "⚠ Received {{signal}}. Saving session...",
    fr: "⚠ Reçu {{signal}}. Sauvegarde de la session...",
    it: "⚠ Ricevuto {{signal}}. Salvataggio sessione...",
    de: "⚠ {{signal}} empfangen. Sitzung wird gespeichert...",
    ru: "⚠ Получен {{signal}}. Сохранение сессии...",
    ja: "⚠ {{signal}} を受信しました。セッションを保存中...",
    ko: "⚠ {{signal}} 수신됨. 세션 저장 중...",
  },
  "shutdown.stats": {
    zh: "  会话: {{requests}} 次请求, {{tokens}} token, 约 {{cost}}",
    en: "  Session: {{requests}} requests, {{tokens}} tokens, ~{{cost}}",
    fr: "  Session: {{requests}} requêtes, {{tokens}} tokens, ~{{cost}}",
    it: "  Sessione: {{requests}} richieste, {{tokens}} token, ~{{cost}}",
    de: "  Sitzung: {{requests}} Anfragen, {{tokens}} Token, ~{{cost}}",
    ru: "  Сессия: {{requests}} запросов, {{tokens}} токенов, ~{{cost}}",
    ja: "  セッション: {{requests}} リクエスト, {{tokens}} トークン, 約 {{cost}}",
    ko: "  세션: {{requests}}개 요청, {{tokens}}개 토큰, 약 {{cost}}",
  },
  "shutdown.saved": {
    zh: "  已保存 {{count}} 条消息",
    en: "  Session saved ({{count}} messages).",
    fr: "  Session sauvegardée ({{count}} messages).",
    it: "  Sessione salvata ({{count}} messaggi).",
    de: "  Sitzung gespeichert ({{count}} Nachrichten).",
    ru: "  Сессия сохранена ({{count}} сообщений).",
    ja: "  セッションを保存しました（{{count}} メッセージ）",
    ko: "  세션이 저장되었습니다 ({{count}}개 메시지)",
  },

  // ─── Session stats table ───────────────────────────────────────────
  "stats.requests": {
    zh: "请求数",
    en: "Requests",
    fr: "Requêtes",
    it: "Richieste",
    de: "Anfragen",
    ru: "Запросы",
    ja: "リクエスト数",
    ko: "요청 수",
  },
  "stats.tokens": {
    zh: "Token 用量",
    en: "Tokens used",
    fr: "Tokens utilisés",
    it: "Token usati",
    de: "Token verwendet",
    ru: "Использовано токенов",
    ja: "トークン使用量",
    ko: "토큰 사용량",
  },
  "stats.prompt": {
    zh: "提示",
    en: "Prompt",
    fr: "Prompt",
    it: "Prompt",
    de: "Prompt",
    ru: "Промпт",
    ja: "プロンプト",
    ko: "프롬프트",
  },
  "stats.completion": {
    zh: "补全",
    en: "Completion",
    fr: "Complétion",
    it: "Completamento",
    de: "Vervollständigung",
    ru: "Завершение",
    ja: "補完",
    ko: "완성",
  },
  "stats.cost": {
    zh: "预估费用",
    en: "Estimated cost",
    fr: "Coût estimé",
    it: "Costo stimato",
    de: "Geschätzte Kosten",
    ru: "Оценочная стоимость",
    ja: "推定費用",
    ko: "예상 비용",
  },

  // ─── Language selection UI ─────────────────────────────────────────
  "lang.prompt": {
    zh: "请选择语言 / Choose language / Выберите язык / 言語を選んでください / 언어를 선택하세요:",
    en: "Please choose a language:",
    fr: "Veuillez choisir une langue :",
    it: "Scegli una lingua:",
    de: "Bitte wählen Sie eine Sprache:",
    ru: "Пожалуйста, выберите язык:",
    ja: "言語を選択してください:",
    ko: "언어를 선택하세요:",
  },
  "lang.selected": {
    zh: "✓ 语言已切换为 {{name}}",
    en: "✓ Language switched to {{name}}",
    fr: "✓ Langue changée en {{name}}",
    it: "✓ Lingua cambiata in {{name}}",
    de: "✓ Sprache gewechselt zu {{name}}",
    ru: "✓ Язык переключён на {{name}}",
    ja: "✓ 言語を {{name}} に切り替えました",
    ko: "✓ 언어가 {{name}} (으)로 전환되었습니다",
  },
  "lang.invalid": {
    zh: "无效选择，请重试",
    en: "Invalid choice, please try again",
    fr: "Choix invalide, veuillez réessayer",
    it: "Scelta non valida, riprova",
    de: "Ungültige Auswahl, bitte versuchen Sie es erneut",
    ru: "Неверный выбор, попробуйте снова",
    ja: "無効な選択です。もう一度お試しください",
    ko: "잘못된 선택입니다. 다시 시도하세요",
  },
  "lang.cancelled": {
    zh: "语言选择已取消",
    en: "Language selection cancelled",
    fr: "Sélection de langue annulée",
    it: "Selezione lingua annullata",
    de: "Sprachauswahl abgebrochen",
    ru: "Выбор языка отменён",
    ja: "言語選択をキャンセルしました",
    ko: "언어 선택이 취소되었습니다",
  },

  // ─── Thinking / reasoning ──────────────────────────────────────────
  "thinking.label": {
    zh: "思考中…",
    en: "Thinking…",
    fr: "Réflexion…",
    it: "Ragionando…",
    de: "Denke nach…",
    ru: "Размышляю…",
    ja: "考え中…",
    ko: "생각 중…",
  },

  // ─── Telegram ────────────────────────────────────────────────────
  "telegram.welcome": {
    zh: "🤖 PoohCode 已连接！发送消息即可开始。支持 /language /clear 命令。",
    en: "🤖 PoohCode connected! Send a message to start. Commands: /language /clear",
    fr: "🤖 PoohCode connecté ! Envoyez un message pour commencer. Commandes : /language /clear",
    it: "🤖 PoohCode connesso! Invia un messaggio per iniziare. Comandi: /language /clear",
    de: "🤖 PoohCode verbunden! Senden Sie eine Nachricht zum Starten. Befehle: /language /clear",
    ru: "🤖 PoohCode подключён! Отправьте сообщение. Команды: /language /clear",
    ja: "🤖 PoohCode に接続しました！メッセージを送信して開始。コマンド: /language /clear",
    ko: "🤖 PoohCode 연결됨! 메시지를 보내 시작하세요. 명령어: /language /clear",
  },
  "telegram.cleared": {
    zh: "🗑 对话已清空",
    en: "🗑 Conversation cleared",
    fr: "🗑 Conversation effacée",
    it: "🗑 Conversazione cancellata",
    de: "🗑 Gespräch zurückgesetzt",
    ru: "🗑 Разговор сброшен",
    ja: "🗑 会話をクリアしました",
    ko: "🗑 대화가 지워졌습니다",
  },
  "telegram.chooseLanguage": {
    zh: "请选择语言：",
    en: "Choose language:",
    fr: "Choisissez la langue :",
    it: "Scegli la lingua:",
    de: "Sprache wählen:",
    ru: "Выберите язык:",
    ja: "言語を選択:",
    ko: "언어를 선택하세요:",
  },
  "telegram.languageSet": {
    zh: "✅ 语言已切换为 {{name}}",
    en: "✅ Language switched to {{name}}",
    fr: "✅ Langue changée en {{name}}",
    it: "✅ Lingua cambiata in {{name}}",
    de: "✅ Sprache gewechselt zu {{name}}",
    ru: "✅ Язык переключён на {{name}}",
    ja: "✅ 言語を {{name}} に切り替えました",
    ko: "✅ 언어가 {{name}}(으)로 전환되었습니다",
  },
  "telegram.error": {
    zh: "❌ 错误",
    en: "❌ Error",
    fr: "❌ Erreur",
    it: "❌ Errore",
    de: "❌ Fehler",
    ru: "❌ Ошибка",
    ja: "❌ エラー",
    ko: "❌ 오류",
  },
  "telegram.noResponse": {
    zh: "（无响应）",
    en: "(no response)",
    fr: "(pas de réponse)",
    it: "(nessuna risposta)",
    de: "(keine Antwort)",
    ru: "(нет ответа)",
    ja: "（応答なし）",
    ko: "(응답 없음)",
  },
  "telegram.confirmTitle": {
    zh: "确认操作: {{name}}",
    en: "Confirm: {{name}}",
    fr: "Confirmer: {{name}}",
    it: "Conferma: {{name}}",
    de: "Bestätigen: {{name}}",
    ru: "Подтвердить: {{name}}",
    ja: "確認: {{name}}",
    ko: "확인: {{name}}",
  },
  "telegram.confirmAllow": {
    zh: "✅ 允许",
    en: "✅ Allow",
    fr: "✅ Autoriser",
    it: "✅ Consenti",
    de: "✅ Erlauben",
    ru: "✅ Разрешить",
    ja: "✅ 許可",
    ko: "✅ 허용",
  },
  "telegram.confirmAllowAll": {
    zh: "✅ 始终允许（本次会话）",
    en: "✅ Always allow (this session)",
    fr: "✅ Toujours autoriser (cette session)",
    it: "✅ Consenti sempre (questa sessione)",
    de: "✅ Immer erlauben (diese Sitzung)",
    ru: "✅ Всегда разрешать (эту сессию)",
    ja: "✅ 常に許可（このセッション）",
    ko: "✅ 항상 허용 (이 세션)",
  },
  "telegram.confirmDeny": {
    zh: "❌ 拒绝",
    en: "❌ Deny",
    fr: "❌ Refuser",
    it: "❌ Nega",
    de: "❌ Ablehnen",
    ru: "❌ Отказать",
    ja: "❌ 拒否",
    ko: "❌ 거부",
  },
  "telegram.confirmedAllow": {
    zh: "已允许",
    en: "Allowed",
    fr: "Autorisé",
    it: "Consentito",
    de: "Erlaubt",
    ru: "Разрешено",
    ja: "許可しました",
    ko: "허용됨",
  },
  "telegram.confirmedAllowAll": {
    zh: "已允许（本会话不再询问）",
    en: "Allowed (no more prompts)",
    fr: "Autorisé (plus de demande)",
    it: "Consentito (nessun altro prompt)",
    de: "Erlaubt (keine weiteren Nachfragen)",
    ru: "Разрешено (больше не спрашивать)",
    ja: "許可しました（これ以上確認しません）",
    ko: "허용됨 (더 이상 묻지 않음)",
  },
  "telegram.confirmedDeny": {
    zh: "已拒绝",
    en: "Denied",
    fr: "Refusé",
    it: "Negato",
    de: "Abgelehnt",
    ru: "Отказано",
    ja: "拒否しました",
    ko: "거부됨",
  },
  "telegram.noPendingConfirm": {
    zh: "没有待确认的操作",
    en: "No pending confirmation",
    fr: "Aucune confirmation en attente",
    it: "Nessuna conferma in sospeso",
    de: "Keine ausstehende Bestätigung",
    ru: "Нет ожидающих подтверждения",
    ja: "保留中の確認はありません",
    ko: "보류 중인 확인이 없습니다",
  },
};

export default t;
