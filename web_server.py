#!/usr/bin/env python3
"""
HTTP Server for the Chinese Chess Game
Serves the static HTML files while the WebSocket server handles game logic
"""

import http.server
import socketserver
import webbrowser
import os
import threading
import time

class ChessHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

def main():
    # Change to the game directory
    os.chdir('/opt/game')
    
    PORT = 8080
    
    print("=" * 60)
    print("🏮 中国象棋在线对战游戏 🏮")
    print("=" * 60)
    print()
    print("✅ WebSocket服务器运行在: ws://localhost:8767")
    print(f"✅ HTTP服务器运行在: http://localhost:{PORT}")
    print()
    print(f"🎮 请在浏览器中访问: http://localhost:{PORT}")
    print()
    print("📋 游戏功能:")
    print("   • 房间创建和加入 (公开/私密房间)")
    print("   • 实时象棋对战")
    print("   • 观战模式")
    print("   • 实时聊天")
    print("   • 私聊功能")
    print("   • 房主管理(踢出/禁言/角色管理)")
    print("   • 作弊检测和拦截")
    print()
    print("🛑 按 Ctrl+C 停止服务器")
    print("=" * 60)
    
    try:
        with socketserver.TCPServer(("", PORT), ChessHTTPRequestHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 HTTP服务器已停止")
    except Exception as e:
        print(f"❌ 启动HTTP服务器失败: {e}")

if __name__ == "__main__":
    main()