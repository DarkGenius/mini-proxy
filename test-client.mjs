// Простой тестовый клиент для проверки прокси

import fs from "node:fs";
import path from "node:path";

const API_KEY = process.env.AGENT_ROUTER_TOKEN || "sk-test";
const BOOLEAN_FLAGS = new Set(["pretty", "json"]);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const [key, inline] = arg.slice(2).split("=");
      if (inline !== undefined) {
        flags[key] = inline === "true" ? true : inline === "false" ? false : inline;
      } else if (
        BOOLEAN_FLAGS.has(key) ||
        argv[i + 1] === undefined ||
        String(argv[i + 1]).startsWith("--")
      ) {
        flags[key] = true;
      } else {
        flags[key] = argv[i + 1];
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function loadConfig() {
  const configPath = path.join(process.cwd(), "config.json");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function resolveRoute(config, requested) {
  const routes = config.routes || {};
  const entries = Object.entries(routes);

  if (requested) {
    if (routes[requested]) {
      return { prefix: requested, targetId: routes[requested] };
    }
    const match = entries.find(([, targetId]) => targetId === requested);
    if (match) {
      return { prefix: match[0], targetId: match[1] };
    }
    return null;
  }

  if (entries.length === 0) return null;
  return { prefix: entries[0][0], targetId: entries[0][1] };
}

function formatCost(usage) {
  const cost =
    usage?.cost ??
    usage?.total_cost ??
    usage?.cost_details?.upstream_inference_cost;
  if (cost == null || cost === "") return "н/д";
  const n = Number(cost);
  if (!Number.isFinite(n)) return String(cost);
  return `$${n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function formatTokens(usage) {
  if (!usage) return "н/д";
  const prompt = usage.prompt_tokens ?? usage.input_tokens;
  const completion = usage.completion_tokens ?? usage.output_tokens;
  const total = usage.total_tokens ?? (prompt ?? 0) + (completion ?? 0);
  const reasoning =
    usage.completion_tokens_details?.reasoning_tokens ??
    usage.reasoning_tokens;
  const parts = [
    `prompt ${prompt ?? "н/д"}`,
    `completion ${completion ?? "н/д"}`,
    `total ${total ?? "н/д"}`,
  ];
  if (reasoning) parts.push(`reasoning ${reasoning}`);
  return parts.join(" · ");
}

function extractReply(data) {
  const choice = data?.choices?.[0];
  const msg = choice?.message || {};
  const content = msg.content || choice?.text || null;
  const reasoning = msg.reasoning || null;
  return { content, reasoning, finishReason: choice?.finish_reason ?? null };
}

function printPretty({ prompt, data, raw }) {
  if (!data) {
    console.log("Ответ (не JSON):");
    console.log(raw);
    return;
  }

  const { content, reasoning, finishReason } = extractReply(data);
  const usage = data.usage || {};

  console.log("Промпт");
  console.log(prompt);
  console.log("");
  console.log("Ответ");
  console.log(content || "(пусто)");
  if (!content && reasoning) {
    console.log("");
    console.log("Рассуждения");
    console.log(reasoning);
  }
  console.log("");
  console.log(`Стоимость:  ${formatCost(usage)}`);
  console.log(`Токены:     ${formatTokens(usage)}`);
  if (finishReason) console.log(`Завершение: ${finishReason}`);
  if (data.model) console.log(`Модель:     ${data.model}`);
  if (data.provider) console.log(`Провайдер:  ${data.provider}`);
}

const config = loadConfig();
const { positional, flags } = parseArgs(process.argv.slice(2));
const requestedTarget =
  flags.target || positional[0] || process.env.PROXY_TARGET;
const MODEL =
  flags.model || positional[1] || process.env.OPENAI_MODEL || "gpt-5";
const PROMPT =
  flags.prompt || process.env.OPENAI_PROMPT || "Say hello";
const MAX_TOKENS = Number(
  flags["max-tokens"] || flags.maxTokens || process.env.OPENAI_MAX_TOKENS || 50
);
if (!Number.isFinite(MAX_TOKENS) || MAX_TOKENS <= 0) {
  console.error(`Некорректный max-tokens: ${flags["max-tokens"] || flags.maxTokens}`);
  process.exit(1);
}
const PRETTY = flags.json ? false : flags.pretty !== false;
const route = resolveRoute(config, requestedTarget);

if (!route) {
  const available = Object.entries(config.routes || {})
    .map(([prefix, targetId]) => `  ${targetId}  (${prefix})`)
    .join("\n");
  console.error(
    requestedTarget
      ? `Target "${requestedTarget}" не найден в config.json`
      : "В config.json нет routes"
  );
  if (available) {
    console.error("Доступные targets:");
    console.error(available);
  }
  process.exit(1);
}

const port = config.port ?? 8787;
const url = `http://localhost:${port}${route.prefix}/v1/chat/completions`;

console.log("========================================");
console.log("Тест Node.js клиента -> прокси");
console.log("========================================");
console.log(`API_KEY: ${API_KEY.substring(0, 20)}...`);
console.log(`MODEL: ${MODEL}`);
console.log(`TARGET: ${route.targetId}`);
console.log(`ROUTE: ${route.prefix}`);
console.log(`PROMPT: ${PROMPT}`);
console.log(`MAX_TOKENS: ${MAX_TOKENS}`);
console.log("");

const requestBody = {
  model: MODEL,
  messages: [{ role: "user", content: PROMPT }],
  max_tokens: MAX_TOKENS,
};

const options = {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify(requestBody),
};

console.log(`Отправка запроса к ${url}`);
console.log("");

try {
  const response = await fetch(url, options);

  console.log(`Статус: ${response.status} ${response.statusText}`);
  console.log("");

  const data = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = null;
  }

  if (PRETTY) {
    printPretty({ prompt: PROMPT, data: parsed, raw: data });
  } else {
    console.log("Ответ:");
    console.log(data);
  }

  if (response.ok) {
    console.log("");
    console.log("✅ Успех!");
  } else {
    console.log("");
    console.log("❌ Ошибка!");
  }
} catch (err) {
  console.error("❌ Ошибка запроса:", err.message);
}

console.log("");
console.log("========================================");
