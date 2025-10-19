# Быстрый старт mini-proxy

## Установка

Клонируйте или скопируйте файлы проекта.

## Конфигурация

Отредактируйте `config.json`:

```json
{
  "port": 8787,
  "routes": {
    "/openrouter": "openrouter",
    "/agentrouter": "agentrouter"
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
    "agentrouter": {
      "baseUrl": "https://agentrouter.org",
      "headers": {
        "User-Agent": "codex_cli_rs/0.47.0 (Linux 5.15.0; x86_64) xterm"
      }
    }
  }
}
```

Установите переменные окружения для ключей API (если используете `${env:...}`).

## Запуск

### Windows PowerShell

```powershell
node server.mjs
```

### Linux/Mac/WSL

```bash
node server.mjs
```

Сервер запустится на порту из конфигурации (по умолчанию 8787).

## Тестирование

### PowerShell (Windows)

```powershell
# Простой способ
.\test.ps1

# Или с параметрами
.\test.ps1 -ApiKey "sk-your-key" -Model "gpt-5"
```

### Bash (Linux/Mac/WSL)

```bash
# Установите переменные
export AGENT_ROUTER_TOKEN="sk-your-key"
export OPENAI_MODEL="gpt-5"

# Автоматический тест (рекомендуется)
bash test-auto.sh

# Или Node.js клиент напрямую
node test-client.mjs
```

## Использование

Настройте ваш инструмент на базовый URL прокси:

```
http://localhost:8787/<префикс>/v1
```

Примеры:

- OpenRouter: `http://localhost:8787/openrouter/v1`
- AgentRouter: `http://localhost:8787/agentrouter/v1`

Прокси автоматически:

- Добавит/переопределит заголовки из конфигурации
- Обрежет префикс при проксировании
- Проксирует все методы и пути

### Пример с OpenAI SDK

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "ignored", // Реальный ключ будет добавлен прокси
  baseURL: "http://localhost:8787/agentrouter/v1",
});

const response = await client.chat.completions.create({
  model: "gpt-5",
  messages: [{ role: "user", content: "Hello" }],
});
```

## Отладка

Запустите с DEBUG_HEADERS для детального логирования:

**PowerShell:**

```powershell
$env:DEBUG_HEADERS="true"
node server.mjs
```

**Bash:**

```bash
DEBUG_HEADERS=true node server.mjs
```

## Известные проблемы

### WSL + curl + heredoc

Не используйте curl с данными из heredoc-файлов в WSL - это вызывает ошибку `HPE_LF_EXPECTED`.

✅ Вместо этого используйте:

- `node test-client.mjs`
- `bash test-auto.sh`
- Inline JSON в curl: `-d '{"key":"value"}'`

## Документация

- [README.md](README.md) - полная документация
- [README-TESTING.md](README-TESTING.md) - детали тестирования и решение проблем
