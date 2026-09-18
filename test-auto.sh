#!/bin/bash

# Автоматический выбор метода тестирования

if [ -f "test.env" ]; then
    # Загружаем переменные и удаляем \r (Windows CRLF -> Unix LF)
    source <(tr -d '\r' < test.env)
fi

# Очищаем переменные от возможных \r
API_KEY=$(echo "${AGENT_ROUTER_TOKEN:-sk-test}" | tr -d '\r')
MODEL=$(echo "${OPENAI_MODEL:-gpt-5}" | tr -d '\r')

echo "=========================================="
echo "Автоматический тест прокси"
echo "=========================================="
echo ""

# Определяем окружение
if grep -qi microsoft /proc/version 2>/dev/null; then
    echo "🐧 Обнаружена WSL"
    echo "⚠️  curl в WSL может иметь проблемы с line endings"
    echo "📋 Рекомендуется использовать: node test-client.mjs"
    echo ""
    IS_WSL=true
else
    echo "🖥️  Обычная Linux/Unix среда"
    IS_WSL=false
fi

echo "=========================================="
echo ""

# Если доступен node, используем его
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js найден - используем test-client.mjs"
    echo ""
    export AGENT_ROUTER_TOKEN="$API_KEY"
    export OPENAI_MODEL="$MODEL"
    node test-client.mjs
    exit 0
fi

# Иначе пробуем curl
if command -v curl >/dev/null 2>&1; then
    echo "✅ curl найден - пробуем POST запрос"
    echo ""
    
    if [ "$IS_WSL" = true ]; then
        echo "⚠️  WSL обнаружена - используем --http1.1 и --data-binary"
        echo ""
    fi
    
    JSON='{"model":"gpt-5","messages":[{"role":"user","content":"Test"}],"max_tokens":10}'
    
    curl --http1.1 \
      -X POST \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${API_KEY}" \
      --data-binary "${JSON}" \
      http://localhost:8787/agentrouter/v1/chat/completions
    
    echo ""
    exit 0
fi

echo "❌ Не найдены ни node, ни curl"
echo "Установите Node.js или curl для тестирования"
exit 1

