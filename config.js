// 游戏配置文件
const GAME_CONFIG = {
    // WebSocket服务器配置
    WEBSOCKET_PORT: 8767,
    
    // 自动检测模式：true = 自动检测，false = 使用手动配置
    AUTO_DETECT_HOST: true,
    
    // 手动配置WebSocket地址（当AUTO_DETECT_HOST为false时使用）
    MANUAL_WEBSOCKET_URL: 'ws://localhost:8767',
    
    // 游戏设置
    GAME_SETTINGS: {
        // 聊天消息最大长度
        MAX_CHAT_LENGTH: 200,
        
        // 用户名最大长度
        MAX_USERNAME_LENGTH: 20,
        
        // 重连尝试次数
        RECONNECT_ATTEMPTS: 3,
        
        // 重连间隔（毫秒）
        RECONNECT_INTERVAL: 3000
    }
};

// 获取WebSocket连接地址
function getWebSocketUrl() {
    if (GAME_CONFIG.AUTO_DETECT_HOST) {
        const hostname = window.location.hostname;
        return hostname === 'localhost' || hostname === '127.0.0.1' 
            ? `ws://localhost:${GAME_CONFIG.WEBSOCKET_PORT}` 
            : `ws://${hostname}:${GAME_CONFIG.WEBSOCKET_PORT}`;
    } else {
        return GAME_CONFIG.MANUAL_WEBSOCKET_URL;
    }
}