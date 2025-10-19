## mini-proxy — минимальный Node.js прокси для OpenAI-совместимых провайдеров

Проксирует запросы к нескольким провайдерам по префиксам путей, принудительно добавляет/заменяет провайдерские заголовки и прозрачно поддерживает стриминг (SSE). Конфигурация — через `config.json` в рабочей директории.

> 🚀 **Быстрый старт:** см. [QUICKSTART.md](QUICKSTART.md)

## Структура проекта

```
mini-proxy/
├── server.mjs           # Основной прокси-сервер
├── config.json          # Конфигурация маршрутов и заголовков
├── test.env             # Переменные окружения для тестов (пример)
├── test-auto.sh         # Автоматический тест (bash)
├── test-simple.sh       # Простой curl-тест (bash)
├── test-client.mjs      # Node.js тестовый клиент
├── test.ps1             # PowerShell тестовый скрипт
├── README.md            # Основная документация
├── QUICKSTART.md        # Быстрый старт
└── README-TESTING.md    # Детали тестирования
```

### Возможности

- Маршрутизация по префиксам пути (правило «самый длинный префикс»)
- Прозрачный стриминг (SSE) без буферизации (опционально)
- Впрыск и переопределение заголовков на таргет
- CORS и обработка `OPTIONS`
- `/healthz` для проверки состояния
- Детальное логирование запросов и ответов

## Требования

- Node.js 18+ (используется встроенный `fetch` и Web Streams)

## Установка и запуск

1. Склонируйте/скопируйте проект с файлами `server.mjs` и `config.json`.
2. При необходимости укажите переменные окружения, используемые в `config.json` (см. ниже).
3. Запустите сервер:

```powershell
# Windows PowerShell
$env:OPENROUTER_API_KEY="..."
$env:PERPLEXITY_API_KEY="..."
node server.mjs
```

```bash
# bash/zsh
export OPENROUTER_API_KEY="..."
export PERPLEXITY_API_KEY="..."
node server.mjs
```

По умолчанию порт берётся из `config.json` (пример — `8787`).

## Конфигурация: config.json

Пример:

```json
{
  "port": 8787,
  "routes": {
    "/openrouter": "openrouter",
    "/perplexity": "perplexity"
  },
  "targets": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api",
      "headers": {
        "Authorization": "Bearer ${env:OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://your-app.example",
        "X-Title": "Your Tool"
      }
    },
    "perplexity": {
      "baseUrl": "https://api.perplexity.ai",
      "headers": {
        "Authorization": "Bearer ${env:PERPLEXITY_API_KEY}",
        "X-Custom-Required": "must-have"
      }
    }
  },
  "cors": {
    "origin": "*",
    "methods": "*",
    "headers": "*",
    "exposeHeaders": ""
  },
  "stripRequestHeaders": ["authorization", "host", "content-length"]
}
```

Пояснения:

- `routes`: сопоставление префикса пути → `targetId`. Выбирается маршрут с наибольшим совпавшим префиксом. Сам префикс при форвардинге обрезается.
- `targets[*].baseUrl`: базовый URL провайдера.
- `targets[*].headers`: заголовки, которые принудительно добавляются/переопределяются для каждого запроса на этот `target` (в т.ч. обязательные провайдерские заголовки).
- `targets[*].pathPrefix` (опц.): дополнительный префикс пути для провайдера.
- `${env:NAME}` внутри значений подставляется из переменных окружения.
- `cors.*`: настройка CORS. По умолчанию — «разрешено всё».
- `stripRequestHeaders`: входящие заголовки, которые всегда удаляются перед форвардингом.

## Базовое использование в инструментах

- Укажите базовый URL вашего инструмента на соответствующий префикс прокси.
  - Пример для OpenRouter: `http://localhost:8787/openrouter`
  - Пример для Perplexity: `http://localhost:8787/perplexity`
- Далее используйте обычные пути API, например `/v1/chat/completions`.

### Примеры curl

Проверка здоровья:

```bash
curl http://localhost:8787/healthz
```

Обычный (нестриминговый) запрос:

```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role":"user","content":"Hello"}],
    "stream": false
  }' \
  http://localhost:8787/openrouter/v1/chat/completions
```

Стриминговый запрос (SSE):

```bash
curl -N -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role":"user","content":"Stream please"}],
    "stream": true
  }' \
  http://localhost:8787/openrouter/v1/chat/completions
```

### Использование с OpenAI SDK (Node.js)

```js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-ignored-by-proxy",
  baseURL: "http://localhost:8787/openrouter/v1", // префикс + стандартный путь
});

const stream = await client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello" }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices?.[0]?.delta?.content || "");
}
```

Примечание: ключ указывается фиктивный — реальные заголовки вставляются прокси из `config.json`.

## Как это работает

- Прокси выбирает целевой `target` по наибольшему совпавшему префиксу пути из `routes`.
- Исходные заголовки клиента фильтруются (удаляются hop-by-hop и `stripRequestHeaders`), затем поверх накладываются `targets[*].headers`.
- Ответ провайдера возвращается как есть; hop-by-hop заголовки и `content-length` при стриме вычищаются.
- При закрытии клиентского соединения исходящий запрос к провайдеру отменяется (`AbortController`).

## Тестирование

### Быстрый тест

**Windows (PowerShell):**

```powershell
$env:AGENT_ROUTER_TOKEN="your-key"
$env:OPENAI_MODEL="gpt-5"
node test-client.mjs
```

**WSL/Linux:**

```bash
# Автоматический выбор метода (рекомендуется)
export AGENT_ROUTER_TOKEN="your-key"
export OPENAI_MODEL="gpt-5"
bash test-auto.sh

# Или напрямую Node.js клиент
node test-client.mjs
```

См. [README-TESTING.md](README-TESTING.md) для подробностей.

## Отладка и ошибки

- 404 `route_not_found`: для пути нет подходящего префикса; проверьте `routes`.
- 502 `bad_gateway` или `target_not_configured`: ошибка сети, неверный `baseUrl`/ключ, либо `targetId` отсутствует в `targets`.
- `HPE_LF_EXPECTED`: Windows line endings (CRLF) в переменных окружения. См. [README-TESTING.md](README-TESTING.md#известные-проблемы-️) для решения.
- Логи сервера печатаются в stdout при запуске (`[proxy] ...`).
- Для детальной отладки: `DEBUG_HEADERS=true node server.mjs`.
