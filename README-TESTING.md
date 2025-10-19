# Тестирование прокси-сервера

## Успешные тесты ✅

Прокси работает корректно! Проверено:

### 1. Node.js клиент (рекомендуется)

```bash
# Установите переменные окружения
export AGENT_ROUTER_TOKEN="ваш-ключ"
export OPENAI_MODEL="gpt-5"

# Запустите тест
node test-client.mjs
```

### 2. Curl в одну строку (работает)

```bash
curl -v \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${AGENT_ROUTER_TOKEN}" \
  -d '{"model":"gpt-5","messages":[{"role":"user","content":"test"}],"max_tokens":10}' \
  http://localhost:8787/agentrouter/v1/chat/completions
```

### 3. Bash-скрипты

```bash
# Автоматический выбор метода (рекомендуется)
bash test-auto.sh

# Или простой curl-скрипт
bash test-simple.sh
```

## Известные проблемы ⚠️

### WSL + Windows line endings (CRLF) = HTTP parse error

**Проблема:** Файлы с переменными окружения (например, `test.env`), созданные в Windows, имеют CRLF line endings (`\r\n`). Bash в WSL читает эти файлы, и переменные содержат невидимый символ `\r`, который попадает в HTTP-заголовки и вызывает ошибку:

```
Parse Error: Missing expected LF after header value (HPE_LF_EXPECTED)
```

**Решение 1 (рекомендуется):** Используйте `tr` для удаления `\r` при загрузке переменных:

```bash
# В ваших скриптах
if [ -f "test.env" ]; then
    # Удаляем \r при загрузке
    source <(tr -d '\r' < test.env)
fi

# Очищаем переменные
API_KEY=$(echo "$AGENT_ROUTER_TOKEN" | tr -d '\r')
```

**Решение 2:** Конвертируйте файлы в Unix format:

```bash
# Один раз конвертируем файл
dos2unix test.env

# Или через sed
sed -i 's/\r$//' test.env
```

**Решение 3:** Используйте Node.js клиент вместо bash:

```bash
node test-client.mjs  # Не имеет проблем с line endings
```

### Многострочные curl команды в WSL

**Проблема:** Многострочные curl команды с `\` могут вызывать проблемы:

```bash
# ❌ МОЖЕТ НЕ РАБОТАТЬ
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  http://...
```

**Решение:** Используйте curl в одну строку:

```bash
# ✅ РАБОТАЕТ
curl -d '{"test":"data"}' -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" http://...
```

### Опция insecureHTTPParser

Прокси запущен с `insecureHTTPParser: true` для максимальной совместимости с различными HTTP-клиентами. Это безопасно для локального использования.

## Рекомендации

1. **Для тестирования:** используйте `test-client.mjs` (Node.js) или `test-simple.sh`
2. **Для production:** используйте любой стандартный HTTP-клиент (не curl + heredoc в WSL)
3. **Для отладки:** запускайте сервер с `DEBUG_HEADERS=true`

## Примеры использования

### OpenAI SDK (Node.js)

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "ignored-by-proxy",
  baseURL: "http://localhost:8787/agentrouter/v1",
});

const response = await client.chat.completions.create({
  model: "gpt-5",
  messages: [{ role: "user", content: "Hello" }],
});
```

### Python requests

```python
import requests

response = requests.post(
    "http://localhost:8787/agentrouter/v1/chat/completions",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    },
    json={
        "model": "gpt-5",
        "messages": [{"role": "user", "content": "Hello"}],
        "max_tokens": 50
    }
)
```

### Curl (правильный способ)

```bash
# Из переменной
DATA='{"model":"gpt-5","messages":[{"role":"user","content":"Hello"}],"max_tokens":50}'
curl -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${API_KEY}" \
     -d "$DATA" \
     http://localhost:8787/agentrouter/v1/chat/completions

# Или inline
curl -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${API_KEY}" \
     -d '{"model":"gpt-5","messages":[{"role":"user","content":"Hello"}]}' \
     http://localhost:8787/agentrouter/v1/chat/completions
```
