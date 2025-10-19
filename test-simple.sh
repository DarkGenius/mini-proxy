#!/bin/bash

# Простой тест прокси - рабочая версия для WSL
# ИСПРАВЛЕНО: обрабатывает Windows line endings (CRLF) в test.env

if [ -f "test.env" ]; then
    # Загружаем переменные и удаляем \r (CRLF -> LF)
    source <(tr -d '\r' < test.env)
fi

# Очищаем переменные от возможных \r
API_KEY=$(echo "${AGENT_ROUTER_TOKEN:-sk-test}" | tr -d '\r')
MODEL=$(echo "${OPENAI_MODEL:-gpt-5}" | tr -d '\r')

echo "=========================================="
echo "Простой тест прокси"
echo "=========================================="
echo "API_KEY: ${API_KEY:0:20}..."
echo "MODEL: $MODEL"
echo ""

echo "Тест 1: healthz endpoint"
echo "=========================================="
curl -s http://localhost:8787/healthz
echo ""
echo ""

echo "Тест 2: POST запрос"
echo "=========================================="

# ВАЖНО: curl в ОДНУ строку! Многострочные curl с \ вызывают проблемы в WSL
curl -s -w "\nHTTP Status: %{http_code}\n" -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello from bash\"}],\"max_tokens\":50}" -H "Content-Type: application/json" -H "Authorization: Bearer $API_KEY" http://localhost:8787/agentrouter/v1/chat/completions

echo ""
echo "=========================================="
echo "Готово"
echo "=========================================="
