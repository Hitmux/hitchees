import asyncio
import websockets
import json
import uuid
from datetime import datetime
from typing import Dict, List, Set, Optional
import hashlib

class Room:
    def __init__(self, room_id: str, name: str, password: str = None, owner: str = None):
        self.room_id = room_id
        self.name = name
        self.password = password
        self.owner = owner
        self.owner_websocket_id = None  # Store owner's websocket ID
        self.players: Dict[str, str] = {}  # websocket_id: username
        self.spectators: Set[str] = set()  # websocket_ids
        self.members: Dict[str, Dict] = {}  # websocket_id: {username, role, join_time, is_muted}
        self.muted_members: Set[str] = set()  # websocket_ids of muted members
        self.chat_history: List[Dict] = []
        self.game_state = ChessGame()
        self.last_move = None  # Store last move for arrow display
        self.created_at = datetime.now()
        
    def add_member(self, websocket_id: str, username: str, role: str = 'spectator') -> bool:
        """Add a member to the room"""
        if role == 'player' and len(self.players) >= 2:
            role = 'spectator'  # Auto-downgrade to spectator if player slots full
        
        # Set owner websocket ID if this is the owner
        if username == self.owner:
            self.owner_websocket_id = websocket_id
        
        self.members[websocket_id] = {
            'username': username,
            'role': role,
            'join_time': datetime.now(),
            'is_muted': False
        }
        
        if role == 'player':
            self.players[websocket_id] = username
            return True
        else:
            self.spectators.add(websocket_id)
            return False
    
    def add_player(self, websocket_id: str, username: str) -> bool:
        """Legacy method - use add_member instead"""
        return self.add_member(websocket_id, username, 'player')
    
    def add_spectator(self, websocket_id: str, username: str = None):
        """Legacy method - use add_member instead"""
        if username:
            self.add_member(websocket_id, username, 'spectator')
        else:
            self.spectators.add(websocket_id)
    
    def change_member_role(self, websocket_id: str, new_role: str) -> bool:
        """Change a member's role (player/spectator)"""
        if websocket_id not in self.members:
            return False
        
        old_role = self.members[websocket_id]['role']
        username = self.members[websocket_id]['username']
        
        # Remove from old role
        if old_role == 'player':
            self.players.pop(websocket_id, None)
        else:
            self.spectators.discard(websocket_id)
        
        # Add to new role
        if new_role == 'player' and len(self.players) < 2:
            self.players[websocket_id] = username
            self.members[websocket_id]['role'] = 'player'
            return True
        elif new_role == 'spectator':
            self.spectators.add(websocket_id)
            self.members[websocket_id]['role'] = 'spectator'
            return True
        else:
            # Revert to old role if new role assignment failed
            if old_role == 'player':
                self.players[websocket_id] = username
            else:
                self.spectators.add(websocket_id)
            return False
    
    def kick_member(self, websocket_id: str) -> bool:
        """Remove a member from the room"""
        if websocket_id not in self.members:
            return False
        
        username = self.members[websocket_id]['username']
        if username == self.owner:  # Cannot kick the owner
            return False
        
        self.remove_user(websocket_id)
        return True
    
    def remove_user(self, websocket_id: str) -> bool:
        """Remove user and return True if room should be deleted"""
        if websocket_id in self.players:
            del self.players[websocket_id]
        self.spectators.discard(websocket_id)
        
        # Check if this was the owner leaving
        if websocket_id in self.members:
            username = self.members[websocket_id]['username']
            del self.members[websocket_id]
            
            if username == self.owner:
                return True  # Room should be deleted
        
        return False  # Room continues
    
    def get_all_users(self) -> Set[str]:
        return set(self.members.keys())
    
    def get_member_list(self) -> List[Dict]:
        """Get formatted member list"""
        member_list = []
        for websocket_id, member_info in self.members.items():
            member_list.append({
                'websocket_id': websocket_id,
                'username': member_info['username'],
                'role': member_info['role'],
                'is_owner': member_info['username'] == self.owner,
                'is_muted': member_info.get('is_muted', False),
                'join_time': member_info['join_time'].isoformat()
            })
        return member_list
    
    def add_chat_message(self, username: str, message: str):
        chat_msg = {
            "username": username,
            "message": message,
            "timestamp": datetime.now().isoformat()
        }
        self.chat_history.append(chat_msg)
    
    def mute_member(self, websocket_id: str) -> bool:
        """Mute a member"""
        if websocket_id not in self.members:
            return False
        
        username = self.members[websocket_id]['username']
        if username == self.owner:  # Cannot mute the owner
            return False
        
        self.members[websocket_id]['is_muted'] = True
        self.muted_members.add(websocket_id)
        return True
    
    def unmute_member(self, websocket_id: str) -> bool:
        """Unmute a member"""
        if websocket_id not in self.members:
            return False
        
        self.members[websocket_id]['is_muted'] = False
        self.muted_members.discard(websocket_id)
        return True
    
    def is_member_muted(self, websocket_id: str) -> bool:
        """Check if a member is muted"""
        return websocket_id in self.muted_members
    
    def is_private(self) -> bool:
        return self.password is not None

class ChessGame:
    def __init__(self):
        self.board = self._initialize_board()
        self.current_player = 'red'  # red starts first
        self.game_status = 'waiting'  # waiting, playing, finished
        self.winner = None
        
    def _initialize_board(self):
        # Initialize Chinese chess board (10x9)
        board = [[None for _ in range(9)] for _ in range(10)]
        
        # Place pieces for red (bottom)
        pieces_red = [
            ('rook', 0, 0), ('horse', 0, 1), ('elephant', 0, 2), ('advisor', 0, 3),
            ('king', 0, 4), ('advisor', 0, 5), ('elephant', 0, 6), ('horse', 0, 7), ('rook', 0, 8),
            ('cannon', 2, 1), ('cannon', 2, 7),
            ('pawn', 3, 0), ('pawn', 3, 2), ('pawn', 3, 4), ('pawn', 3, 6), ('pawn', 3, 8)
        ]
        
        # Place pieces for black (top)
        pieces_black = [
            ('rook', 9, 0), ('horse', 9, 1), ('elephant', 9, 2), ('advisor', 9, 3),
            ('king', 9, 4), ('advisor', 9, 5), ('elephant', 9, 6), ('horse', 9, 7), ('rook', 9, 8),
            ('cannon', 7, 1), ('cannon', 7, 7),
            ('pawn', 6, 0), ('pawn', 6, 2), ('pawn', 6, 4), ('pawn', 6, 6), ('pawn', 6, 8)
        ]
        
        for piece_type, row, col in pieces_red:
            board[row][col] = {'type': piece_type, 'color': 'red'}
        
        for piece_type, row, col in pieces_black:
            board[row][col] = {'type': piece_type, 'color': 'black'}
        
        return board
    
    def is_valid_move(self, from_row: int, from_col: int, to_row: int, to_col: int, player_color: str) -> tuple:
        # Validate move according to Chinese chess rules
        if not (0 <= from_row <= 9 and 0 <= from_col <= 8 and 0 <= to_row <= 9 and 0 <= to_col <= 8):
            return False, "Invalid position"
        
        piece = self.board[from_row][from_col]
        if not piece:
            return False, "No piece at source position"
        
        if piece['color'] != player_color:
            return False, "Not your piece"
        
        if self.current_player != player_color:
            return False, "Not your turn"
        
        target = self.board[to_row][to_col]
        if target and target['color'] == player_color:
            return False, "Cannot capture your own piece"
        
        # Check piece-specific movement rules
        if not self._is_valid_piece_move(piece['type'], from_row, from_col, to_row, to_col, piece['color']):
            return False, "Invalid move for this piece"
        
        # Create a temporary board to test the move
        temp_board = [row[:] for row in self.board]
        temp_board[to_row][to_col] = temp_board[from_row][from_col]
        temp_board[from_row][from_col] = None
        
        # Check if this move would result in facing kings (将军对将)
        if self._would_kings_face_each_other(temp_board):
            return False, "Kings cannot face each other directly"
        
        return True, "Valid move"
    
    def _is_valid_piece_move(self, piece_type: str, from_row: int, from_col: int, to_row: int, to_col: int, color: str) -> bool:
        # Implement Chinese chess piece movement rules
        row_diff = abs(to_row - from_row)
        col_diff = abs(to_col - from_col)
        
        if piece_type == 'pawn':
            return self._is_valid_pawn_move(from_row, from_col, to_row, to_col, color)
        elif piece_type == 'rook':
            return self._is_valid_rook_move(from_row, from_col, to_row, to_col)
        elif piece_type == 'horse':
            return self._is_valid_horse_move(from_row, from_col, to_row, to_col)
        elif piece_type == 'elephant':
            return self._is_valid_elephant_move(from_row, from_col, to_row, to_col, color)
        elif piece_type == 'advisor':
            return self._is_valid_advisor_move(from_row, from_col, to_row, to_col, color)
        elif piece_type == 'king':
            return self._is_valid_king_move(from_row, from_col, to_row, to_col, color)
        elif piece_type == 'cannon':
            return self._is_valid_cannon_move(from_row, from_col, to_row, to_col)
        
        return False
    
    def _is_valid_pawn_move(self, from_row: int, from_col: int, to_row: int, to_col: int, color: str) -> bool:
        if color == 'red':
            if from_row <= 4:  # Haven't crossed river
                return to_row == from_row + 1 and to_col == from_col
            else:  # Crossed river
                return (to_row == from_row + 1 and to_col == from_col) or (to_row == from_row and abs(to_col - from_col) == 1)
        else:  # black
            if from_row >= 5:  # Haven't crossed river
                return to_row == from_row - 1 and to_col == from_col
            else:  # Crossed river
                return (to_row == from_row - 1 and to_col == from_col) or (to_row == from_row and abs(to_col - from_col) == 1)
    
    def _is_valid_rook_move(self, from_row: int, from_col: int, to_row: int, to_col: int) -> bool:
        if from_row != to_row and from_col != to_col:
            return False
        
        # Check if path is clear
        if from_row == to_row:
            start_col, end_col = sorted([from_col, to_col])
            for col in range(start_col + 1, end_col):
                if self.board[from_row][col]:
                    return False
        else:
            start_row, end_row = sorted([from_row, to_row])
            for row in range(start_row + 1, end_row):
                if self.board[row][from_col]:
                    return False
        
        return True
    
    def _is_valid_horse_move(self, from_row: int, from_col: int, to_row: int, to_col: int) -> bool:
        row_diff = abs(to_row - from_row)
        col_diff = abs(to_col - from_col)
        
        if not ((row_diff == 2 and col_diff == 1) or (row_diff == 1 and col_diff == 2)):
            return False
        
        # Check blocking piece
        if row_diff == 2:
            block_row = from_row + (1 if to_row > from_row else -1)
            if self.board[block_row][from_col]:
                return False
        else:
            block_col = from_col + (1 if to_col > from_col else -1)
            if self.board[from_row][block_col]:
                return False
        
        return True
    
    def _is_valid_elephant_move(self, from_row: int, from_col: int, to_row: int, to_col: int, color: str) -> bool:
        if abs(to_row - from_row) != 2 or abs(to_col - from_col) != 2:
            return False
        
        # Cannot cross river
        if color == 'red' and to_row > 4:
            return False
        if color == 'black' and to_row < 5:
            return False
        
        # Check blocking piece at center
        center_row = (from_row + to_row) // 2
        center_col = (from_col + to_col) // 2
        if self.board[center_row][center_col]:
            return False
        
        return True
    
    def _is_valid_advisor_move(self, from_row: int, from_col: int, to_row: int, to_col: int, color: str) -> bool:
        if abs(to_row - from_row) != 1 or abs(to_col - from_col) != 1:
            return False
        
        # Must stay in palace
        if color == 'red':
            return 0 <= to_row <= 2 and 3 <= to_col <= 5
        else:
            return 7 <= to_row <= 9 and 3 <= to_col <= 5
    
    def _is_valid_king_move(self, from_row: int, from_col: int, to_row: int, to_col: int, color: str) -> bool:
        if abs(to_row - from_row) + abs(to_col - from_col) != 1:
            return False
        
        # Must stay in palace
        if color == 'red':
            return 0 <= to_row <= 2 and 3 <= to_col <= 5
        else:
            return 7 <= to_row <= 9 and 3 <= to_col <= 5
    
    def _is_valid_cannon_move(self, from_row: int, from_col: int, to_row: int, to_col: int) -> bool:
        if from_row != to_row and from_col != to_col:
            return False
        
        pieces_between = 0
        if from_row == to_row:
            start_col, end_col = sorted([from_col, to_col])
            for col in range(start_col + 1, end_col):
                if self.board[from_row][col]:
                    pieces_between += 1
        else:
            start_row, end_row = sorted([from_row, to_row])
            for row in range(start_row + 1, end_row):
                if self.board[row][from_col]:
                    pieces_between += 1
        
        target = self.board[to_row][to_col]
        if target:  # Capturing
            return pieces_between == 1
        else:  # Moving
            return pieces_between == 0
    
    def make_move(self, from_row: int, from_col: int, to_row: int, to_col: int) -> bool:
        piece = self.board[from_row][from_col]
        self.board[to_row][to_col] = piece
        self.board[from_row][from_col] = None
        
        # Switch turn
        self.current_player = 'black' if self.current_player == 'red' else 'red'
        
        # Check for game end conditions
        if self._is_checkmate():
            self.game_status = 'finished'
            self.winner = 'red' if self.current_player == 'black' else 'black'
        
        return True

    def _is_checkmate(self) -> bool:
        # Simple implementation - check if king is captured
        red_king = False
        black_king = False
        
        for row in range(10):
            for col in range(9):
                piece = self.board[row][col]
                if piece and piece['type'] == 'king':
                    if piece['color'] == 'red':
                        red_king = True
                    else:
                        black_king = True
        
        return not (red_king and black_king)
    
    def _would_kings_face_each_other(self, board) -> bool:
        """Check if the two kings would face each other directly on the same column"""
        red_king_pos = None
        black_king_pos = None
        
        # Find both kings
        for row in range(10):
            for col in range(9):
                piece = board[row][col]
                if piece and piece['type'] == 'king':
                    if piece['color'] == 'red':
                        red_king_pos = (row, col)
                    else:
                        black_king_pos = (row, col)
        
        # If either king is missing, no face-off possible
        if not red_king_pos or not black_king_pos:
            return False
        
        red_row, red_col = red_king_pos
        black_row, black_col = black_king_pos
        
        # Kings must be on the same column to face each other
        if red_col != black_col:
            return False
        
        # Check if there are any pieces between the kings
        start_row = min(red_row, black_row) + 1
        end_row = max(red_row, black_row)
        
        for row in range(start_row, end_row):
            if board[row][red_col]:  # There's a piece between kings
                return False
        
        return True  # Kings are facing each other directly

class ChessServer:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self.connections: Dict[str, websockets.WebSocketServerProtocol] = {}  # websocket_id: websocket
        self.user_sessions: Dict[str, str] = {}  # websocket_id: username
        
    def generate_room_id(self) -> str:
        return str(uuid.uuid4())[:8].upper()
    
    def create_room(self, name: str, password: str = None, owner: str = None) -> str:
        room_id = self.generate_room_id()
        while room_id in self.rooms:
            room_id = self.generate_room_id()
        
        self.rooms[room_id] = Room(room_id, name, password, owner)
        return room_id
    
    def get_websocket_id(self, websocket) -> str:
        return str(id(websocket))
    
    async def register_connection(self, websocket):
        websocket_id = self.get_websocket_id(websocket)
        self.connections[websocket_id] = websocket
    
    async def unregister_connection(self, websocket):
        websocket_id = self.get_websocket_id(websocket)
        
        # Remove from rooms and check if room should be deleted
        rooms_to_delete = []
        for room_id, room in self.rooms.items():
            should_delete = room.remove_user(websocket_id)
            if should_delete:
                rooms_to_delete.append(room_id)
                # Notify all remaining members that room is being deleted
                await self.broadcast_to_room(room_id, {
                    'type': 'room_deleted',
                    'message': '房主已退出，房间即将关闭'
                })
        
        # Delete empty or owner-less rooms
        for room_id in rooms_to_delete:
            del self.rooms[room_id]
        
        # Clean up
        self.connections.pop(websocket_id, None)
        self.user_sessions.pop(websocket_id, None)
    
    async def broadcast_to_room(self, room_id: str, message: dict, exclude_sender: str = None):
        if room_id not in self.rooms:
            return
        
        room = self.rooms[room_id]
        recipients = room.get_all_users()
        
        if exclude_sender:
            recipients.discard(exclude_sender)
        
        for websocket_id in recipients:
            if websocket_id in self.connections:
                try:
                    await self.connections[websocket_id].send(json.dumps(message))
                except websockets.exceptions.ConnectionClosed:
                    pass
    
    async def send_to_user(self, websocket_id: str, message: dict):
        if websocket_id in self.connections:
            try:
                await self.connections[websocket_id].send(json.dumps(message))
            except websockets.exceptions.ConnectionClosed:
                pass
    
    async def handle_message(self, websocket, message_str: str):
        websocket_id = self.get_websocket_id(websocket)
        
        try:
            message = json.loads(message_str)
            action = message.get('action')
            
            if action == 'set_username':
                await self.handle_set_username(websocket_id, message)
            elif action == 'create_room':
                await self.handle_create_room(websocket_id, message)
            elif action == 'join_room':
                await self.handle_join_room(websocket_id, message)
            elif action == 'leave_room':
                await self.handle_leave_room(websocket_id, message)
            elif action == 'get_room_list':
                await self.handle_get_room_list(websocket_id)
            elif action == 'chat_message':
                await self.handle_chat_message(websocket_id, message)
            elif action == 'make_move':
                await self.handle_make_move(websocket_id, message)
            elif action == 'start_game':
                await self.handle_start_game(websocket_id, message)
            elif action == 'private_message':
                await self.handle_private_message(websocket_id, message)
            elif action == 'change_member_role':
                await self.handle_change_member_role(websocket_id, message)
            elif action == 'kick_member':
                await self.handle_kick_member(websocket_id, message)
            elif action == 'get_member_list':
                await self.handle_get_member_list(websocket_id, message)
            elif action == 'mute_member':
                await self.handle_mute_member(websocket_id, message)
            elif action == 'unmute_member':
                await self.handle_unmute_member(websocket_id, message)
            else:
                await self.send_to_user(websocket_id, {
                    'type': 'error',
                    'message': 'Unknown action'
                })
        
        except json.JSONDecodeError:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Invalid JSON'
            })
        except Exception as e:
            print(f"Error handling message: {e}")
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Server error'
            })
    
    async def handle_set_username(self, websocket_id: str, message: dict):
        username = message.get('username', '').strip()
        if not username:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Username cannot be empty'
            })
            return
        
        # Check if username is already taken by another active connection
        for existing_websocket_id, existing_username in self.user_sessions.items():
            if existing_websocket_id != websocket_id and existing_username == username:
                await self.send_to_user(websocket_id, {
                    'type': 'error',
                    'message': f'用户名 "{username}" 已被使用，请选择其他用户名'
                })
                return
        
        self.user_sessions[websocket_id] = username
        await self.send_to_user(websocket_id, {
            'type': 'username_set',
            'username': username
        })
    
    async def handle_create_room(self, websocket_id: str, message: dict):
        if websocket_id not in self.user_sessions:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Please set username first'
            })
            return
        
        username = self.user_sessions[websocket_id]
        room_name = message.get('room_name', f"{username}'s room")
        password = message.get('password', None)
        
        room_id = self.create_room(room_name, password, username)
        
        await self.send_to_user(websocket_id, {
            'type': 'room_created',
            'room_id': room_id,
            'room_name': room_name,
            'is_private': password is not None
        })
    
    async def handle_join_room(self, websocket_id: str, message: dict):
        if websocket_id not in self.user_sessions:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Please set username first'
            })
            return
        
        room_id = message.get('room_id')
        password = message.get('password', '')
        join_as = message.get('join_as', 'spectator')  # player or spectator
        
        if room_id not in self.rooms:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Room not found'
            })
            return
        
        room = self.rooms[room_id]
        username = self.user_sessions[websocket_id]
        
        # Check password for private rooms
        if room.is_private() and password != room.password:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Incorrect password'
            })
            return
        
        # Add member to room
        is_player = room.add_member(websocket_id, username, join_as)
        actual_role = 'player' if is_player else 'spectator'
        
        # Send room info to user
        await self.send_to_user(websocket_id, {
            'type': 'joined_room',
            'room_id': room_id,
            'room_name': room.name,
            'join_as': actual_role,
            'players': list(room.players.values()),
            'spectators': len(room.spectators),
            'member_list': room.get_member_list(),
            'chat_history': room.chat_history,
            'last_move': room.last_move,
            'game_state': {
                'board': room.game_state.board,
                'current_player': room.game_state.current_player,
                'game_status': room.game_state.game_status,
                'winner': room.game_state.winner
            }
        })
        
        # Notify others in room
        await self.broadcast_to_room(room_id, {
            'type': 'user_joined',
            'username': username,
            'join_as': actual_role,
            'players': list(room.players.values()),
            'spectators': len(room.spectators),
            'member_list': room.get_member_list()
        }, exclude_sender=websocket_id)
    
    async def handle_leave_room(self, websocket_id: str, message: dict):
        # Find and remove user from any room
        for room_id, room in self.rooms.items():
            if websocket_id in room.get_all_users():
                username = self.user_sessions.get(websocket_id, 'Unknown')
                room.remove_user(websocket_id)
                
                await self.broadcast_to_room(room_id, {
                    'type': 'user_left',
                    'username': username,
                    'players': list(room.players.values()),
                    'spectators': len(room.spectators)
                })
                break
        
        await self.send_to_user(websocket_id, {
            'type': 'left_room'
        })
    
    async def handle_get_room_list(self, websocket_id: str):
        room_list = []
        for room in self.rooms.values():
            room_info = {
                'room_id': room.room_id,
                'room_name': room.name,
                'is_private': room.is_private(),
                'players': len(room.players),
                'spectators': len(room.spectators),
                'game_status': room.game_state.game_status
            }
            room_list.append(room_info)
        
        await self.send_to_user(websocket_id, {
            'type': 'room_list',
            'rooms': room_list
        })
    
    async def handle_chat_message(self, websocket_id: str, message: dict):
        if websocket_id not in self.user_sessions:
            return
        
        username = self.user_sessions[websocket_id]
        chat_text = message.get('message', '').strip()
        
        if not chat_text:
            return
        
        # Find user's room
        user_room_id = None
        for room_id, room in self.rooms.items():
            if websocket_id in room.get_all_users():
                user_room_id = room_id
                break
        
        if user_room_id:
            room = self.rooms[user_room_id]
            
            # Check if user is muted
            if room.is_member_muted(websocket_id):
                await self.send_to_user(websocket_id, {
                    'type': 'chat_rejected',
                    'reason': '您已被禁言，无法发送消息'
                })
                return
            
            room.add_chat_message(username, chat_text)
            
            await self.broadcast_to_room(user_room_id, {
                'type': 'chat_message',
                'username': username,
                'message': chat_text,
                'timestamp': datetime.now().isoformat()
            })
    
    async def handle_make_move(self, websocket_id: str, message: dict):
        if websocket_id not in self.user_sessions:
            return
        
        username = self.user_sessions[websocket_id]
        
        # Find user's room
        user_room_id = None
        for room_id, room in self.rooms.items():
            if websocket_id in room.players:
                user_room_id = room_id
                break
        
        if not user_room_id:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'You are not a player in any room'
            })
            return
        
        room = self.rooms[user_room_id]
        
        # Determine player color
        players = list(room.players.items())
        if len(players) != 2:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Need 2 players to make moves'
            })
            return
        
        player_color = 'red' if players[0][0] == websocket_id else 'black'
        
        from_row = message.get('from_row')
        from_col = message.get('from_col')
        to_row = message.get('to_row')
        to_col = message.get('to_col')
        
        if any(x is None for x in [from_row, from_col, to_row, to_col]):
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Invalid move parameters'
            })
            return
        
        # Validate move
        is_valid, reason = room.game_state.is_valid_move(from_row, from_col, to_row, to_col, player_color)
        
        if not is_valid:
            # Potential cheating attempt
            room.add_chat_message('System', f"{username}可能在作弊，已经拦截！")
            await self.broadcast_to_room(user_room_id, {
                'type': 'chat_message',
                'username': 'System',
                'message': f"{username}可能在作弊，已经拦截！",
                'timestamp': datetime.now().isoformat()
            })
            
            await self.send_to_user(websocket_id, {
                'type': 'move_rejected',
                'reason': reason
            })
            return
        
        # Make move
        room.game_state.make_move(from_row, from_col, to_row, to_col)
        
        # Store last move for arrow display
        room.last_move = {
            'from_row': from_row,
            'from_col': from_col,
            'to_row': to_row,
            'to_col': to_col,
            'player': username
        }
        
        # Broadcast move to all users in room
        await self.broadcast_to_room(user_room_id, {
            'type': 'move_made',
            'from_row': from_row,
            'from_col': from_col,
            'to_row': to_row,
            'to_col': to_col,
            'player': username,
            'current_player': room.game_state.current_player,
            'game_status': room.game_state.game_status,
            'winner': room.game_state.winner,
            'board': room.game_state.board,
            'last_move': room.last_move
        })
    
    async def handle_start_game(self, websocket_id: str, message: dict):
        # Find user's room where they are owner
        user_room_id = None
        username = self.user_sessions.get(websocket_id)
        
        for room_id, room in self.rooms.items():
            if room.owner == username and websocket_id in room.players:
                user_room_id = room_id
                break
        
        if not user_room_id:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Only room owner can start the game'
            })
            return
        
        room = self.rooms[user_room_id]
        
        if len(room.players) != 2:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Need 2 players to start game'
            })
            return
        
        room.game_state.game_status = 'playing'
        
        await self.broadcast_to_room(user_room_id, {
            'type': 'game_started',
            'current_player': room.game_state.current_player,
            'board': room.game_state.board
        })

    async def handle_private_message(self, websocket_id: str, message: dict):
        """Handle private messages between users"""
        if websocket_id not in self.user_sessions:
            return
        
        sender = self.user_sessions[websocket_id]
        target_username = message.get('target_username')
        msg_content = message.get('message', '').strip()
        
        if not target_username or not msg_content:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Invalid private message'
            })
            return
        
        # Find target user's websocket_id
        target_websocket_id = None
        for ws_id, username in self.user_sessions.items():
            if username == target_username:
                target_websocket_id = ws_id
                break
        
        if not target_websocket_id:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'User not found'
            })
            return
        
        # Send private message
        private_msg = {
            'type': 'private_message',
            'from': sender,
            'to': target_username,
            'message': msg_content,
            'timestamp': datetime.now().isoformat()
        }
        
        # Send to both sender and recipient
        await self.send_to_user(target_websocket_id, private_msg)
        await self.send_to_user(websocket_id, {**private_msg, 'type': 'private_message_sent'})

    async def handle_change_member_role(self, websocket_id: str, message: dict):
        """Handle role changes by room owner"""
        if websocket_id not in self.user_sessions:
            return
        
        username = self.user_sessions[websocket_id]
        target_websocket_id = message.get('target_websocket_id')
        new_role = message.get('new_role')
        
        # Find user's room where they are owner
        user_room = None
        for room in self.rooms.values():
            if websocket_id in room.members and room.owner == username:
                user_room = room
                break
        
        if not user_room:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'You are not a room owner or not in any room'
            })
            return
        
        if target_websocket_id not in user_room.members:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Target user not in room'
            })
            return
        
        # Change role
        if user_room.change_member_role(target_websocket_id, new_role):
            target_username = user_room.members[target_websocket_id]['username']
            
            # Broadcast role change
            await self.broadcast_to_room(user_room.room_id, {
                'type': 'member_role_changed',
                'username': target_username,
                'new_role': new_role,
                'member_list': user_room.get_member_list(),
                'players': list(user_room.players.values()),
                'spectators': len(user_room.spectators)
            })
        else:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Failed to change role'
            })

    async def handle_kick_member(self, websocket_id: str, message: dict):
        """Handle member kicking by room owner"""
        if websocket_id not in self.user_sessions:
            return
        
        username = self.user_sessions[websocket_id]
        target_websocket_id = message.get('target_websocket_id')
        
        # Find user's room where they are owner
        user_room = None
        for room in self.rooms.values():
            if websocket_id in room.members and room.owner == username:
                user_room = room
                break
        
        if not user_room:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'You are not a room owner or not in any room'
            })
            return
        
        if user_room.kick_member(target_websocket_id):
            target_username = self.user_sessions.get(target_websocket_id, 'Unknown')
            
            # Notify kicked user
            await self.send_to_user(target_websocket_id, {
                'type': 'kicked_from_room',
                'message': '你已被房主踢出房间'
            })
            
            # Broadcast to room
            await self.broadcast_to_room(user_room.room_id, {
                'type': 'member_kicked',
                'username': target_username,
                'member_list': user_room.get_member_list(),
                'players': list(user_room.players.values()),
                'spectators': len(user_room.spectators)
            }, exclude_sender=target_websocket_id)
        else:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Failed to kick member'
            })

    async def handle_get_member_list(self, websocket_id: str, message: dict):
        """Get current member list for a room"""
        # Find user's current room
        user_room = None
        for room in self.rooms.values():
            if websocket_id in room.members:
                user_room = room
                break
        
        if user_room:
            await self.send_to_user(websocket_id, {
                'type': 'member_list',
                'member_list': user_room.get_member_list(),
                'is_owner': websocket_id == user_room.owner_websocket_id
            })
        else:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Not in any room'
            })

    async def handle_mute_member(self, websocket_id: str, message: dict):
        """Mute a member"""
        target_websocket_id = message.get('target_websocket_id')
        
        if not target_websocket_id:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Target websocket ID required'
            })
            return
        
        # Find user's room and check if they are owner
        user_room = None
        for room in self.rooms.values():
            if websocket_id in room.members and websocket_id == room.owner_websocket_id:
                user_room = room
                break
        
        if not user_room:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Only room owner can mute members'
            })
            return
        
        if target_websocket_id not in user_room.members:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Target user not in room'
            })
            return
        
        target_username = user_room.members[target_websocket_id]['username']
        
        if user_room.mute_member(target_websocket_id):
            await self.broadcast_to_room(user_room.room_id, {
                'type': 'member_muted',
                'username': target_username,
                'member_list': user_room.get_member_list()
            })
        else:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Failed to mute member'
            })

    async def handle_unmute_member(self, websocket_id: str, message: dict):
        """Unmute a member"""
        target_websocket_id = message.get('target_websocket_id')
        
        if not target_websocket_id:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Target websocket ID required'
            })
            return
        
        # Find user's room and check if they are owner
        user_room = None
        for room in self.rooms.values():
            if websocket_id in room.members and websocket_id == room.owner_websocket_id:
                user_room = room
                break
        
        if not user_room:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Only room owner can unmute members'
            })
            return
        
        if target_websocket_id not in user_room.members:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Target user not in room'
            })
            return
        
        target_username = user_room.members[target_websocket_id]['username']
        
        if user_room.unmute_member(target_websocket_id):
            await self.broadcast_to_room(user_room.room_id, {
                'type': 'member_unmuted',
                'username': target_username,
                'member_list': user_room.get_member_list()
            })
        else:
            await self.send_to_user(websocket_id, {
                'type': 'error',
                'message': 'Failed to unmute member'
            })

# WebSocket handler
async def handle_client(websocket, path):
    server = chess_server
    await server.register_connection(websocket)
    
    try:
        async for message in websocket:
            await server.handle_message(websocket, message)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        await server.unregister_connection(websocket)

# Global server instance
chess_server = ChessServer()

if __name__ == "__main__":
    print("Starting Chinese Chess Server on port 8767...")
    print("Server will be available at ws://localhost:8767")
    print("Press Ctrl+C to stop the server")
    
    start_server = websockets.serve(handle_client, "0.0.0.0", 8767)
    
    try:
        asyncio.get_event_loop().run_until_complete(start_server)
        asyncio.get_event_loop().run_forever()
    except KeyboardInterrupt:
        print("\nServer stopped by user")
    except Exception as e:
        print(f"Server error: {e}")