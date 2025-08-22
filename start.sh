#!/bin/bash

echo "🏮 中国象棋在线对战游戏"
echo "========================"

cd "$(dirname "$0")"

# 检查依赖
if ! python3 -c "import websockets" &> /dev/null; then
    echo "❌ 请先安装依赖: sudo apt install python3-websockets"
    exit 1
fi

echo "🚀 启动服务器..."

# 启动WebSocket服务器
python3 server.py &
WS_PID=$!

# 启动HTTP服务器  
python3 web_server.py &
HTTP_PID=$!

sleep 3

echo "✅ 服务器启动成功!"
echo "🌐 游戏地址: http://localhost:8080"
echo "🛑 按 Ctrl+C 停止"

# 清理函数
cleanup() {
    echo -e "\n🛑 停止服务器..."
    kill $WS_PID $HTTP_PID 2>/dev/null
    exit 0
}

trap cleanup INT TERM
wait
