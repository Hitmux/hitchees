class ChessClient {
    constructor() {
        this.websocket = null;
        this.username = '';
        this.currentRoom = null;
        this.isPlayer = false;
        this.playerColor = null;
        this.selectedPiece = null;
        this.gameBoard = [];
        this.memberList = [];
        this.isOwner = false;
        this.lastMove = null;
        this.boardFlipped = false;
        this.boardRotated = false; // Track physical rotation
        this.pmWindow = null;
        this.pmTarget = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isMobile = this.detectMobile();
        
        this.init();
    }

    detectMobile() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
    }

    init() {
        this.setupEventListeners();
        this.checkAutoLogin();
    }

    // Cookie management
    setCookie(name, value, days = 30) {
        const expires = new Date();
        expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
        document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
    }

    getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }

    deleteCookie(name) {
        document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/;`;
    }

    checkAutoLogin() {
        const savedUsername = this.getCookie('chess_username');
        if (savedUsername) {
            // Auto login with saved username
            this.username = savedUsername;
            document.getElementById('username-input').value = savedUsername;
            this.showScreen('main-menu');
            this.connectToServer();
        } else {
            // Show login screen
            this.showScreen('login-screen');
        }
    }

    setupEventListeners() {
        // Login
        document.getElementById('login-btn').addEventListener('click', () => this.handleLogin());
        document.getElementById('username-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleLogin();
        });

        // Main Menu
        document.getElementById('create-room-btn').addEventListener('click', () => this.showCreateRoomDialog());
        document.getElementById('join-room-btn').addEventListener('click', () => this.showJoinRoomDialog());
        document.getElementById('room-list-btn').addEventListener('click', () => this.showRoomList());
        document.getElementById('logout-btn').addEventListener('click', () => this.handleLogout());

        // Create Room Dialog
        document.getElementById('private-room-checkbox').addEventListener('change', (e) => {
            const passwordGroup = document.getElementById('password-group');
            passwordGroup.style.display = e.target.checked ? 'block' : 'none';
        });
        document.getElementById('create-room-confirm').addEventListener('click', () => this.handleCreateRoom());
        document.getElementById('create-room-cancel').addEventListener('click', () => this.hideDialog('create-room-dialog'));

        // Join Room Dialog
        document.getElementById('join-room-confirm').addEventListener('click', () => this.handleJoinRoom());
        document.getElementById('join-room-cancel').addEventListener('click', () => this.hideDialog('join-room-dialog'));

        // Room List
        document.getElementById('room-list-close').addEventListener('click', () => this.hideRoomList());

        // Game Room
        document.getElementById('start-game-btn').addEventListener('click', () => this.handleStartGame());
        document.getElementById('rotate-board-btn').addEventListener('click', () => this.rotateBoard());
        document.getElementById('leave-room-btn').addEventListener('click', () => this.handleLeaveRoom());

        // Chat
        document.getElementById('send-chat-btn').addEventListener('click', () => this.sendChatMessage());
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });

        // Chat Tabs
        document.querySelectorAll('.chat-tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        // Private Message Window
        this.setupPrivateMessageWindow();

        // Private Message Input
        document.getElementById('send-private-message').addEventListener('click', () => this.sendPrivateMessage());
        document.getElementById('private-message-text').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendPrivateMessage();
        });
        
        // Window resize listener for responsive board adjustments
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                // Update mobile detection on resize
                this.isMobile = this.detectMobile();
                // Redraw board if it's currently visible
                const board = document.getElementById('chess-board');
                if (board && board.innerHTML !== '') {
                    this.renderChessBoard();
                }
            }, 250); // Debounce resize events
        });
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.chat-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.style.display = 'none';
        });
        document.getElementById(`${tabName}-tab-content`).style.display = 'flex';

        // Load member list if switching to members tab
        if (tabName === 'members') {
            this.updateMemberList();
        }
    }

    // WebSocket Connection
    async connectToServer() {
        this.showLoading(true);
        
        // 使用配置文件获取WebSocket地址
        const wsUrl = getWebSocketUrl();
        console.log('Connecting to WebSocket:', wsUrl);
        
        try {
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('Connected to server');
                this.showLoading(false);
                this.sendMessage({action: 'set_username', username: this.username});
            };

            this.websocket.onmessage = (event) => {
                const message = JSON.parse(event.data);
                this.handleServerMessage(message);
            };

            this.websocket.onclose = () => {
                console.log('Disconnected from server');
                this.showToast('与服务器断开连接', 'error');
                this.showScreen('login-screen');
            };

            this.websocket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.showLoading(false);
                this.showToast('连接服务器失败', 'error');
            };

        } catch (error) {
            this.showLoading(false);
            this.showToast('连接服务器失败', 'error');
        }
    }

    sendMessage(message) {
        if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
            this.websocket.send(JSON.stringify(message));
        }
    }

    // Server Message Handler
    handleServerMessage(message) {
        console.log('Received:', message);

        switch (message.type) {
            case 'username_set':
                this.showScreen('main-menu');
                document.getElementById('current-username').textContent = this.username;
                break;

            case 'room_created':
                this.showToast(`房间创建成功: ${message.room_id}`, 'success');
                this.hideDialog('create-room-dialog');
                // Automatically join the created room
                this.sendMessage({
                    action: 'join_room',
                    room_id: message.room_id,
                    join_as: 'player'
                });
                break;

            case 'joined_room':
                this.currentRoom = message.room_id;
                this.isPlayer = message.join_as === 'player';
                this.memberList = message.member_list || [];
                this.isOwner = this.memberList.some(m => m.username === this.username && m.is_owner);
                this.lastMove = message.last_move;
                this.showScreen('game-room');
                this.updateRoomInfo(message);
                this.updateGameBoard(message.game_state);
                this.hideDialog('join-room-dialog');
                this.hideRoomList();
                
                // Determine player color and flip board
                this.updatePlayerColor();
                if (this.isPlayer && this.playerColor === 'black') {
                    this.boardFlipped = true;
                }
                break;

            case 'room_list':
                this.displayRoomList(message.rooms);
                break;

            case 'user_joined':
                this.memberList = message.member_list || [];
                this.updatePlayerInfo(message);
                this.updateMemberList();
                this.showToast(`${message.username} 加入了房间`, 'info');
                break;

            case 'user_left':
                this.memberList = message.member_list || [];
                this.updatePlayerInfo(message);
                this.updateMemberList();
                this.showToast(`用户离开了房间`, 'info');
                break;

            case 'member_role_changed':
                this.memberList = message.member_list || [];
                this.updatePlayerInfo(message);
                this.updateMemberList();
                this.showToast(`${message.username} 角色已更改为 ${message.new_role === 'player' ? '对战' : '观战'}`, 'info');
                break;

            case 'member_kicked':
                this.memberList = message.member_list || [];
                this.updatePlayerInfo(message);
                this.updateMemberList();
                this.showToast(`${message.username} 已被踢出房间`, 'info');
                break;

            case 'kicked_from_room':
                this.showToast(message.message, 'error');
                this.showScreen('main-menu');
                this.currentRoom = null;
                this.isPlayer = false;
                this.playerColor = null;
                break;

            case 'room_deleted':
                this.showToast(message.message, 'error');
                this.showScreen('main-menu');
                this.currentRoom = null;
                this.isPlayer = false;
                this.playerColor = null;
                break;

            case 'chat_message':
                this.addChatMessage(message);
                break;

            case 'private_message':
                this.handlePrivateMessage(message);
                break;

            case 'private_message_sent':
                this.showToast(`私信已发送给 ${message.to}`, 'success');
                break;

            case 'move_made':
                this.handleMoveMade(message);
                break;

            case 'game_started':
                this.handleGameStarted(message);
                break;

            case 'left_room':
                this.showScreen('main-menu');
                this.currentRoom = null;
                this.isPlayer = false;
                this.playerColor = null;
                this.boardFlipped = false;
                break;

            case 'error':
                this.showToast(message.message, 'error');
                break;

            case 'move_rejected':
                this.showToast(`移动无效: ${message.reason}`, 'error');
                this.clearSelection();
                break;

            case 'member_muted':
                this.memberList = message.member_list || [];
                this.updateMemberList();
                this.showToast(`${message.username} 已被禁言`, 'info');
                break;

            case 'member_unmuted':
                this.memberList = message.member_list || [];
                this.updateMemberList();
                this.showToast(`${message.username} 禁言已解除`, 'info');
                break;

            case 'chat_rejected':
                this.showToast(`消息被拒绝: ${message.reason}`, 'error');
                break;

            default:
                console.log('Unknown message type:', message.type);
        }
    }

    // UI Methods
    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    }

    showDialog(dialogId) {
        document.getElementById(dialogId).classList.remove('hidden');
    }

    hideDialog(dialogId) {
        document.getElementById(dialogId).classList.add('hidden');
        // Clear form inputs
        document.querySelectorAll(`#${dialogId} input`).forEach(input => {
            input.value = '';
        });
        document.querySelectorAll(`#${dialogId} select`).forEach(select => {
            select.selectedIndex = 0;
        });
        document.querySelectorAll(`#${dialogId} input[type="checkbox"]`).forEach(checkbox => {
            checkbox.checked = false;
        });
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        const container = document.getElementById('toast-container');
        container.appendChild(toast);

        // Auto remove after 3 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    // Event Handlers
    handleLogin() {
        const username = document.getElementById('username-input').value.trim();
        if (!username) {
            this.showToast('请输入用户名', 'error');
            return;
        }
        if (username.length > 20) {
            this.showToast('用户名不能超过20个字符', 'error');
            return;
        }

        this.username = username;
        this.setCookie('chess_username', username); // Save username to cookies
        this.connectToServer();
    }

    handleLogout() {
        if (confirm('确定要退出吗？这将清除保存的用户名。')) {
            this.deleteCookie('chess_username');
            document.getElementById('username-input').value = '';
            if (this.websocket) {
                this.websocket.close();
            }
            this.showScreen('login-screen');
            this.showToast('已退出登录', 'info');
        }
    }

    showCreateRoomDialog() {
        this.showDialog('create-room-dialog');
        document.getElementById('room-name-input').value = `${this.username}的房间`;
    }

    handleCreateRoom() {
        const roomName = document.getElementById('room-name-input').value.trim();
        const isPrivate = document.getElementById('private-room-checkbox').checked;
        const password = isPrivate ? document.getElementById('room-password-input').value.trim() : null;

        if (!roomName) {
            this.showToast('请输入房间名称', 'error');
            return;
        }

        if (isPrivate && !password) {
            this.showToast('私密房间需要设置密码', 'error');
            return;
        }

        this.sendMessage({
            action: 'create_room',
            room_name: roomName,
            password: password
        });
    }

    showJoinRoomDialog() {
        this.showDialog('join-room-dialog');
    }

    handleJoinRoom() {
        const roomId = document.getElementById('join-room-id-input').value.trim();
        const password = document.getElementById('join-room-password-input').value.trim();
        const joinAs = document.getElementById('join-as-select').value;

        if (!roomId) {
            this.showToast('请输入房间号', 'error');
            return;
        }

        this.sendMessage({
            action: 'join_room',
            room_id: roomId,
            password: password,
            join_as: joinAs
        });
    }

    showRoomList() {
        document.getElementById('room-list').classList.remove('hidden');
        this.sendMessage({action: 'get_room_list'});
    }

    hideRoomList() {
        document.getElementById('room-list').classList.add('hidden');
    }

    displayRoomList(rooms) {
        const container = document.getElementById('rooms-container');
        container.innerHTML = '';

        if (rooms.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: #6c757d;">暂无房间</p>';
            return;
        }

        rooms.forEach(room => {
            const roomItem = document.createElement('div');
            roomItem.className = `room-item ${room.is_private ? 'private' : ''}`;
            roomItem.innerHTML = `
                <div class="room-info">
                    <div class="room-name">${room.room_name} ${room.is_private ? '🔒' : ''}</div>
                    <div class="room-stats">
                        ID: ${room.room_id} | 
                        玩家: ${room.players}/2 | 
                        观众: ${room.spectators} | 
                        状态: ${this.getGameStatusText(room.game_status)}
                    </div>
                </div>
            `;

            roomItem.addEventListener('click', () => {
                this.hideRoomList();
                document.getElementById('join-room-id-input').value = room.room_id;
                this.showJoinRoomDialog();
            });

            container.appendChild(roomItem);
        });
    }

    getGameStatusText(status) {
        switch (status) {
            case 'waiting': return '等待中';
            case 'playing': return '游戏中';
            case 'finished': return '已结束';
            default: return status;
        }
    }

    handleStartGame() {
        this.sendMessage({action: 'start_game'});
    }

    handleLeaveRoom() {
        this.sendMessage({action: 'leave_room'});
    }

    sendChatMessage() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();

        if (!message) return;

        this.sendMessage({
            action: 'chat_message',
            message: message
        });

        input.value = '';
    }

    // Game UI Methods
    updateRoomInfo(roomData) {
        document.getElementById('room-name').textContent = roomData.room_name || 'Unknown Room';
        document.getElementById('room-id').textContent = roomData.room_id || 'Unknown';

        this.updatePlayerInfo({
            players: roomData.players || [],
            spectators: roomData.spectators || 0
        });

        // Show start game button for room owner if player
        const startGameBtn = document.getElementById('start-game-btn');
        if (this.isPlayer && roomData.players && roomData.players.length > 0 && roomData.players[0] === this.username) {
            startGameBtn.style.display = 'block';
        } else {
            startGameBtn.style.display = 'none';
        }

        // Load chat history
        if (roomData.chat_history) {
            roomData.chat_history.forEach(msg => this.addChatMessage(msg));
        }
    }

    updatePlayerInfo(data) {
        const redPlayerEl = document.getElementById('red-player');
        const blackPlayerEl = document.getElementById('black-player');
        const spectatorCountEl = document.getElementById('spectator-count');

        const players = data.players || [];
        redPlayerEl.textContent = players[0] || '等待玩家...';
        blackPlayerEl.textContent = players[1] || '等待玩家...';
        spectatorCountEl.textContent = data.spectators || 0;

        // Update player color and board orientation
        this.updatePlayerColor();
    }

    updatePlayerColor() {
        if (!this.isPlayer) return;
        
        const redPlayerEl = document.getElementById('red-player');
        const blackPlayerEl = document.getElementById('black-player');
        
        const redPlayer = redPlayerEl.textContent;
        const blackPlayer = blackPlayerEl.textContent;
        
        // Determine player color
        if (redPlayer === this.username) {
            this.playerColor = 'red';
            this.boardFlipped = true; // Flip so red player sees their pieces at bottom
        } else if (blackPlayer === this.username) {
            this.playerColor = 'black';  
            this.boardFlipped = false; // Don't flip for black so they see their pieces at bottom
        }
        
        // Re-render board if color changed
        if (this.gameBoard.length > 0) {
            this.renderChessBoard();
            if (this.lastMove) {
                this.showMoveArrow(this.lastMove);
            }
        }
    }

    rotateBoard() {
        const board = document.getElementById('chess-board');
        this.boardRotated = !this.boardRotated;
        
        if (this.boardRotated) {
            board.classList.add('rotated');
        } else {
            board.classList.remove('rotated');
        }
        
        // Clear and redraw arrow if it exists
        if (this.lastMove) {
            this.showMoveArrow(this.lastMove);
        }
    }

    // Adjust coordinates for board rotation
    adjustCoordinatesForRotation(row, col) {
        if (this.boardRotated) {
            return {
                row: 9 - row,
                col: 8 - col
            };
        }
        return { row, col };
    }

    addChatMessage(message) {
        const chatMessages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${message.username === 'System' ? 'system' : ''}`;

        if (message.username === 'System') {
            messageDiv.innerHTML = `<span class="message">${message.message}</span>`;
        } else {
            const timestamp = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit'
            });
            messageDiv.innerHTML = `
                <span class="username">${message.username}:</span>
                <span class="message">${message.message}</span>
                <span class="timestamp">${timestamp}</span>
            `;
        }

        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Chess Board Methods
    updateGameBoard(gameState) {
        this.gameBoard = gameState.board || [];
        this.renderChessBoard();
        
        // Show arrow for last move if available
        if (this.lastMove) {
            this.showMoveArrow(this.lastMove);
        }
        
        const currentTurnEl = document.getElementById('current-turn');
        if (gameState.game_status === 'waiting') {
            currentTurnEl.textContent = '等待游戏开始';
        } else if (gameState.game_status === 'finished') {
            currentTurnEl.textContent = `游戏结束 - ${gameState.winner === 'red' ? '红方' : '黑方'}胜利`;
        } else {
            const currentPlayer = gameState.current_player === 'red' ? '红方' : '黑方';
            currentTurnEl.textContent = `当前回合: ${currentPlayer}`;
            
            // Highlight current player's turn
            if (this.isPlayer && gameState.current_player === this.playerColor) {
                currentTurnEl.style.color = '#28a745';
                currentTurnEl.textContent += ' (你的回合)';
            } else {
                currentTurnEl.style.color = '#8B4513';
            }
        }
    }

    renderChessBoard() {
        const board = document.getElementById('chess-board');
        board.innerHTML = '';

        // Calculate dynamic spacing based on actual board size
        this.updateBoardDimensions();

        // Draw board lines
        this.drawBoardLines(board);
        
        // Draw river markers
        this.drawRiverMarkers(board);

        // Draw pieces and intersections
        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 9; col++) {
                this.createIntersection(board, row, col);
            }
        }
    }

    updateBoardDimensions() {
        const board = document.getElementById('chess-board');
        const boardStyle = window.getComputedStyle(board);
        const boardWidth = parseInt(boardStyle.width);
        const boardHeight = parseInt(boardStyle.height);
        
        // Calculate grid spacing (8 columns, 9 rows for intersections)
        this.gridSpacingX = (boardWidth - 50) / 8;  // 25px margins on each side
        this.gridSpacingY = (boardHeight - 50) / 9; // 25px margins on each side
        this.marginX = 25;
        this.marginY = 25;
    }

    drawBoardLines(board) {
        // Horizontal lines
        for (let i = 0; i <= 9; i++) {
            const line = document.createElement('div');
            line.className = 'chess-line horizontal';
            line.style.top = `${i * this.gridSpacingY + this.marginY}px`;
            line.style.left = `${this.marginX}px`;
            line.style.right = `${this.marginX}px`;
            board.appendChild(line);
        }

        // Vertical lines
        for (let i = 0; i <= 8; i++) {
            const line = document.createElement('div');
            line.className = 'chess-line vertical';
            line.style.left = `${i * this.gridSpacingX + this.marginX}px`;
            line.style.top = `${this.marginY}px`;
            
            // River break for middle columns
            if (i >= 1 && i <= 7) {
                line.style.height = `${4 * this.gridSpacingY}px`; // Top half (4 rows)
                const bottomLine = line.cloneNode();
                bottomLine.style.top = `${5 * this.gridSpacingY + this.marginY}px`;
                bottomLine.style.height = `${4 * this.gridSpacingY}px`; // Bottom half (4 rows)
                board.appendChild(bottomLine);
            } else {
                line.style.height = `${9 * this.gridSpacingY}px`; // Full height for edge columns
            }
            
            board.appendChild(line);
        }

        // Palace diagonal lines
        this.drawPalaceLines(board, 0); // Top palace (black)
        this.drawPalaceLines(board, 7); // Bottom palace (red)
    }

    drawPalaceLines(board, startRow) {
        const palaceLines = [
            // Top-left to bottom-right
            {
                x1: 3 * this.gridSpacingX + this.marginX, 
                y1: startRow * this.gridSpacingY + this.marginY, 
                x2: 5 * this.gridSpacingX + this.marginX, 
                y2: (startRow + 2) * this.gridSpacingY + this.marginY
            },
            // Top-right to bottom-left
            {
                x1: 5 * this.gridSpacingX + this.marginX, 
                y1: startRow * this.gridSpacingY + this.marginY, 
                x2: 3 * this.gridSpacingX + this.marginX, 
                y2: (startRow + 2) * this.gridSpacingY + this.marginY
            }
        ];

        palaceLines.forEach(line => {
            const lineEl = document.createElement('div');
            lineEl.style.position = 'absolute';
            lineEl.style.background = '#8B4513';
            lineEl.style.height = '2px';
            
            const length = Math.sqrt(Math.pow(line.x2 - line.x1, 2) + Math.pow(line.y2 - line.y1, 2));
            const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI;
            
            lineEl.style.width = length + 'px';
            lineEl.style.left = line.x1 + 'px';
            lineEl.style.top = line.y1 + 'px';
            lineEl.style.transformOrigin = '0 0';
            lineEl.style.transform = `rotate(${angle}deg)`;
            
            board.appendChild(lineEl);
        });
    }

    drawRiverMarkers(board) {
        const leftMarker = document.createElement('div');
        leftMarker.className = 'river-marker';
        leftMarker.textContent = '楚河';
        leftMarker.style.left = `${1.5 * this.gridSpacingX + this.marginX}px`;
        leftMarker.style.top = `${4.3 * this.gridSpacingY + this.marginY}px`;
        board.appendChild(leftMarker);

        const rightMarker = document.createElement('div');
        rightMarker.className = 'river-marker';
        rightMarker.textContent = '汉界';
        rightMarker.style.left = `${5.5 * this.gridSpacingX + this.marginX}px`;
        rightMarker.style.top = `${4.3 * this.gridSpacingY + this.marginY}px`;
        board.appendChild(rightMarker);
    }

    createIntersection(board, row, col) {
        // Use actual display positions considering board flip
        const displayRow = this.boardFlipped ? (9 - row) : row;
        const displayCol = this.boardFlipped ? (8 - col) : col;
        
        const intersection = document.createElement('div');
        intersection.className = 'chess-intersection';
        intersection.style.left = `${displayCol * this.gridSpacingX + this.marginX}px`;
        intersection.style.top = `${displayRow * this.gridSpacingY + this.marginY}px`;
        intersection.dataset.row = row;
        intersection.dataset.col = col;

        intersection.addEventListener('click', () => this.handleIntersectionClick(row, col));
        
        // Add touch support for mobile
        if (this.isMobile) {
            intersection.addEventListener('touchend', (e) => {
                e.preventDefault();
                this.handleIntersectionClick(row, col);
            });
        }

        // Add piece if exists
        if (this.gameBoard[row] && this.gameBoard[row][col]) {
            const piece = this.createChessPiece(this.gameBoard[row][col], row, col);
            intersection.appendChild(piece);
        }

        board.appendChild(intersection);
    }

    createChessPiece(pieceData, row, col) {
        const piece = document.createElement('div');
        piece.className = `chess-piece ${pieceData.color}`;
        piece.dataset.row = row;
        piece.dataset.col = col;
        piece.textContent = this.getPieceText(pieceData.type, pieceData.color);

        piece.addEventListener('click', (e) => {
            e.stopPropagation();
            this.handlePieceClick(row, col);
        });

        // Add touch support for mobile
        if (this.isMobile) {
            piece.addEventListener('touchend', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.handlePieceClick(row, col);
            });
        }

        return piece;
    }

    getPieceText(type, color) {
        const pieces = {
            red: {
                king: '帅', advisor: '仕', elephant: '相', horse: '马',
                rook: '车', cannon: '炮', pawn: '兵'
            },
            black: {
                king: '将', advisor: '士', elephant: '象', horse: '马',
                rook: '车', cannon: '炮', pawn: '卒'
            }
        };
        return pieces[color][type] || type;
    }

    handlePieceClick(row, col) {
        if (!this.isPlayer || !this.canMakeMove()) {
            return;
        }

        // Adjust coordinates for board rotation
        const adjustedCoords = this.adjustCoordinatesForRotation(row, col);
        const actualRow = adjustedCoords.row;
        const actualCol = adjustedCoords.col;

        const piece = this.gameBoard[actualRow][actualCol];
        
        // If clicking own piece, select it
        if (piece && piece.color === this.playerColor) {
            this.selectPiece(actualRow, actualCol);
        }
        // If clicking opponent piece or empty space with selected piece, try to move
        else if (this.selectedPiece) {
            this.makeMove(this.selectedPiece.row, this.selectedPiece.col, actualRow, actualCol);
        }
    }

    handleIntersectionClick(row, col) {
        if (!this.isPlayer || !this.canMakeMove()) {
            return;
        }

        // Adjust coordinates for board rotation
        const adjustedCoords = this.adjustCoordinatesForRotation(row, col);
        const actualRow = adjustedCoords.row;
        const actualCol = adjustedCoords.col;

        if (this.selectedPiece) {
            this.makeMove(this.selectedPiece.row, this.selectedPiece.col, actualRow, actualCol);
        }
    }

    selectPiece(row, col) {
        this.clearSelection();
        
        this.selectedPiece = { row, col };
        
        // Highlight selected piece
        const pieceEl = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        if (pieceEl) {
            pieceEl.classList.add('selected');
        }
    }

    clearSelection() {
        // Remove all selection highlights
        document.querySelectorAll('.chess-piece.selected').forEach(el => {
            el.classList.remove('selected');
        });
        
        this.selectedPiece = null;
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        this.sendMessage({
            action: 'make_move',
            from_row: fromRow,
            from_col: fromCol,
            to_row: toRow,
            to_col: toCol
        });
        
        this.clearSelection();
    }

    canMakeMove() {
        // Check if it's the player's turn
        const currentTurnEl = document.getElementById('current-turn');
        return currentTurnEl.textContent.includes('(你的回合)');
    }

    handleMoveMade(moveData) {
        // Update board state
        this.gameBoard = moveData.board;
        this.lastMove = moveData.last_move;
        this.renderChessBoard();
        
        // Show move arrow
        this.showMoveArrow(this.lastMove);
        
        // Update game status
        this.updateGameBoard({
            board: moveData.board,
            current_player: moveData.current_player,
            game_status: moveData.game_status,
            winner: moveData.winner
        });

        // Show move notification
        this.showToast(`${moveData.player} 移动了棋子`, 'info');
    }

    handleGameStarted(gameData) {
        this.updateGameBoard(gameData);
        this.showToast('游戏开始！', 'success');
        
        // Hide start game button
        document.getElementById('start-game-btn').style.display = 'none';
    }

    // Member management methods
    updateMemberList() {
        const memberListEl = document.getElementById('member-list');
        if (!memberListEl) return;

        memberListEl.innerHTML = '';

        this.memberList.forEach(member => {
            const memberItem = document.createElement('div');
            memberItem.className = 'member-item';
            
            const memberInfo = document.createElement('div');
            memberInfo.className = 'member-info';
            
            const username = document.createElement('span');
            username.textContent = member.username;
            memberInfo.appendChild(username);

            const role = document.createElement('span');
            role.className = `member-role ${member.role}${member.is_owner ? ' owner' : ''}`;
            let roleText = member.is_owner ? '房主' : (member.role === 'player' ? '对战' : '观战');
            if (member.is_muted) {
                roleText += ' [禁言]';
                role.style.opacity = '0.6';
            }
            role.textContent = roleText;
            memberInfo.appendChild(role);

            memberItem.appendChild(memberInfo);

            // Actions for other members
            if (member.username !== this.username) {
                const actions = document.createElement('div');
                actions.className = 'member-actions';

                // Private message button
                const pmBtn = document.createElement('button');
                pmBtn.className = 'member-btn pm';
                pmBtn.textContent = '私信';
                pmBtn.onclick = () => this.showPrivateMessageDialog(member.username);
                actions.appendChild(pmBtn);

                // Owner controls
                if (this.isOwner && !member.is_owner) {
                    // Role change button
                    const roleBtn = document.createElement('button');
                    roleBtn.className = 'member-btn role';
                    roleBtn.textContent = member.role === 'player' ? '改观战' : '改对战';
                    roleBtn.onclick = () => this.changeMemberRole(member.websocket_id, member.role === 'player' ? 'spectator' : 'player');
                    actions.appendChild(roleBtn);

                    // Mute button
                    const muteBtn = document.createElement('button');
                    muteBtn.className = 'member-btn mute';
                    muteBtn.textContent = member.is_muted ? '解除禁言' : '禁言';
                    muteBtn.onclick = () => this.toggleMemberMute(member.websocket_id, !member.is_muted);
                    actions.appendChild(muteBtn);

                    // Kick button
                    const kickBtn = document.createElement('button');
                    kickBtn.className = 'member-btn kick';
                    kickBtn.textContent = '踢出';
                    kickBtn.onclick = () => this.kickMember(member.websocket_id);
                    actions.appendChild(kickBtn);
                }

                memberItem.appendChild(actions);
            }

            memberListEl.appendChild(memberItem);
        });
    }

    showPrivateMessageDialog(targetUsername) {
        this.pmTarget = targetUsername;
        const pmWindow = document.getElementById('private-message-window');
        const pmTargetEl = document.getElementById('pm-target-user');
        const pmMessagesEl = document.getElementById('private-messages');
        
        pmTargetEl.textContent = targetUsername;
        pmMessagesEl.innerHTML = ''; // Clear previous messages
        
        pmWindow.classList.remove('hidden');
        
        // Focus on input
        document.getElementById('private-message-text').focus();
    }

    changeMemberRole(websocketId, newRole) {
        this.sendMessage({
            action: 'change_member_role',
            target_websocket_id: websocketId,
            new_role: newRole
        });
    }

    kickMember(websocketId) {
        if (confirm('确定要踢出这个成员吗？')) {
            this.sendMessage({
                action: 'kick_member',
                target_websocket_id: websocketId
            });
        }
    }

    toggleMemberMute(websocketId, shouldMute) {
        const action = shouldMute ? 'mute_member' : 'unmute_member';
        const confirmText = shouldMute ? '确定要禁言这个成员吗？' : '确定要解除禁言吗？';
        
        if (confirm(confirmText)) {
            this.sendMessage({
                action: action,
                target_websocket_id: websocketId
            });
        }
    }

    handlePrivateMessage(message) {
        this.showToast(`${message.from}: ${message.message}`, 'info', 5000);
        
        // Open private message window if not already open for this user
        const pmWindow = document.getElementById('private-message-window');
        const currentTarget = document.getElementById('pm-target-user').textContent;
        
        if (pmWindow.classList.contains('hidden') || currentTarget !== message.from) {
            this.showPrivateMessageDialog(message.from);
        }
        
        // Add message to private message window only
        this.addPrivateMessageToWindow(message.from, message.message, 'received');
    }

    // Arrow display methods
    showMoveArrow(lastMove) {
        this.clearMoveArrow();
        
        if (!lastMove) return;

        const board = document.getElementById('chess-board');
        const fromPos = this.getBoardPosition(lastMove.from_row, lastMove.from_col);
        const toPos = this.getBoardPosition(lastMove.to_row, lastMove.to_col);

        // Create arrow container positioned at the board
        const arrow = document.createElement('div');
        arrow.className = 'move-arrow';
        arrow.id = 'current-move-arrow';
        arrow.style.position = 'absolute';
        arrow.style.top = '0';
        arrow.style.left = '0';
        arrow.style.width = '100%';
        arrow.style.height = '100%';
        arrow.style.pointerEvents = 'none';
        arrow.style.zIndex = '5';

        const deltaX = toPos.x - fromPos.x;
        const deltaY = toPos.y - fromPos.y;
        const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const angle = Math.atan2(deltaY, deltaX) * 180 / Math.PI;

        // Create arrow line
        const line = document.createElement('div');
        line.style.position = 'absolute';
        line.style.width = `${length - 20}px`;
        line.style.left = `${fromPos.x}px`;
        line.style.top = `${fromPos.y - 3}px`;
        line.style.transform = `rotate(${angle}deg)`;
        line.style.transformOrigin = '0 center';
        line.style.height = '6px';
        line.style.background = 'linear-gradient(90deg, #FF6B6B, #FF8E8E)';
        line.style.borderRadius = '3px';
        line.style.boxShadow = '0 2px 8px rgba(255,107,107,0.6)';
        line.style.border = '1px solid #FF4444';

        // Create arrow head - make it more visible
        const head = document.createElement('div');
        head.style.position = 'absolute';
        head.style.left = `${toPos.x - 12}px`;
        head.style.top = `${toPos.y - 12}px`;
        head.style.width = '0';
        head.style.height = '0';
        head.style.borderLeft = '12px solid transparent';
        head.style.borderRight = '12px solid transparent';
        head.style.borderBottom = '20px solid #FF4444';
        head.style.transform = `rotate(${angle}deg)`;
        head.style.transformOrigin = 'center bottom';
        head.style.filter = 'drop-shadow(0 2px 4px rgba(255,68,68,0.8))';

        arrow.appendChild(line);
        arrow.appendChild(head);
        board.appendChild(arrow);
    }

    clearMoveArrow() {
        const existingArrow = document.getElementById('current-move-arrow');
        if (existingArrow) {
            existingArrow.remove();
        }
    }

    getBoardPosition(row, col) {
        // Consider board flipping for players
        const actualRow = this.boardFlipped ? (9 - row) : row;
        const actualCol = this.boardFlipped ? (8 - col) : col;
        
        return {
            x: actualCol * this.gridSpacingX + this.marginX, // Dynamic position within board
            y: actualRow * this.gridSpacingY + this.marginY  // Dynamic position within board
        };
    }

    // Enhanced toast with custom duration
    showToast(message, type = 'info', duration = 3000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        const container = document.getElementById('toast-container');
        container.appendChild(toast);

        // Auto remove after specified duration
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, duration);
    }

    // Private Message Window Methods
    setupPrivateMessageWindow() {
        const pmWindow = document.getElementById('private-message-window');
        const pmHeader = document.querySelector('.private-message-header');
        const closeBtn = document.getElementById('close-private-message');

        // Close button
        closeBtn.addEventListener('click', () => {
            pmWindow.classList.add('hidden');
        });

        // Make window draggable
        pmHeader.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.doDrag(e));
        document.addEventListener('mouseup', () => this.endDrag());
    }

    startDrag(e) {
        this.isDragging = true;
        const pmWindow = document.getElementById('private-message-window');
        const rect = pmWindow.getBoundingClientRect();
        
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
        
        pmWindow.style.cursor = 'move';
        e.preventDefault();
    }

    doDrag(e) {
        if (!this.isDragging) return;
        
        const pmWindow = document.getElementById('private-message-window');
        const newX = e.clientX - this.dragOffset.x;
        const newY = e.clientY - this.dragOffset.y;
        
        // Keep window within viewport
        const maxX = window.innerWidth - pmWindow.offsetWidth;
        const maxY = window.innerHeight - pmWindow.offsetHeight;
        
        const clampedX = Math.max(0, Math.min(newX, maxX));
        const clampedY = Math.max(0, Math.min(newY, maxY));
        
        pmWindow.style.left = clampedX + 'px';
        pmWindow.style.top = clampedY + 'px';
        pmWindow.style.right = 'auto'; // Remove right positioning
    }

    endDrag() {
        if (!this.isDragging) return;
        
        this.isDragging = false;
        const pmWindow = document.getElementById('private-message-window');
        pmWindow.style.cursor = 'default';
    }

    sendPrivateMessage() {
        const input = document.getElementById('private-message-text');
        const message = input.value.trim();
        
        if (!message || !this.pmTarget) return;
        
        this.sendMessage({
            action: 'private_message',
            target_username: this.pmTarget,
            message: message
        });
        
        // Add message to window
        this.addPrivateMessageToWindow(this.username, message, 'sent');
        input.value = '';
    }

    addPrivateMessageToWindow(username, message, type) {
        const pmMessages = document.getElementById('private-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `private-message-item ${type}`;
        
        const time = new Date().toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });
        
        messageDiv.innerHTML = `
            <div class="sender">${username}</div>
            <div class="content">${message}</div>
            <div class="time">${time}</div>
        `;
        
        pmMessages.appendChild(messageDiv);
        pmMessages.scrollTop = pmMessages.scrollHeight;
    }
}

// Initialize the game client when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new ChessClient();
});