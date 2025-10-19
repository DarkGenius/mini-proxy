// Простой тестовый клиент для проверки прокси

const API_KEY = process.env.AGENT_ROUTER_TOKEN || "sk-test";
const MODEL = process.env.OPENAI_MODEL || "gpt-5";

console.log("========================================");
console.log("Тест Node.js клиента -> прокси");
console.log("========================================");
console.log(`API_KEY: ${API_KEY.substring(0, 20)}...`);
console.log(`MODEL: ${MODEL}`);
console.log("");

const requestBody = {
  model: MODEL,
  messages: [{ role: "user", content: "Say hello" }],
  max_tokens: 50,
};

const options = {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify(requestBody),
};

console.log(
  "Отправка запроса к http://localhost:8787/agentrouter/v1/chat/completions"
);
console.log("");

try {
  const response = await fetch(
    "http://localhost:8787/agentrouter/v1/chat/completions",
    options
  );

  console.log(`Статус: ${response.status} ${response.statusText}`);
  console.log("");

  const data = await response.text();
  console.log("Ответ:");
  console.log(data);

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
