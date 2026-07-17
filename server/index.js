const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const rooms = require('./rooms');

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function send(ws, type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function sendError(ws, message) {
  send(ws, 'error', { message });
}

function broadcastRoom(room, type, payload) {
  for (const role of ['host', 'guest']) {
    const p = room.players[role];
    if (p && p.ws) send(p.ws, type, payload);
  }
}

function requireRoom(ws) {
  if (!ws.roomCode || !ws.role) {
    sendError(ws, 'Вы не в комнате');
    return null;
  }
  const room = rooms.getRoom(ws.roomCode);
  if (!room) {
    sendError(ws, 'Комната не найдена');
    return null;
  }
  return room;
}

function onCreateRoom(ws) {
  const room = rooms.createRoom();
  room.players.host.ws = ws;
  room.players.host.connected = true;
  ws.roomCode = room.code;
  ws.role = 'host';
  send(ws, 'room_created', { code: room.code, role: 'host' });
}

function onJoinRoom(ws, payload) {
  const code = payload && payload.code ? String(payload.code).toUpperCase() : '';
  const room = rooms.getRoom(code);
  if (!room) return sendError(ws, 'Комната не найдена');
  if (room.status !== 'waiting' || room.players.guest.connected) {
    return sendError(ws, 'В этой комнате уже идёт игра');
  }
  room.players.guest.ws = ws;
  room.players.guest.connected = true;
  room.status = 'placing';
  ws.roomCode = code;
  ws.role = 'guest';
  send(ws, 'room_joined', { code, role: 'guest' });
  broadcastRoom(room, 'opponent_joined', {});
}

function onPlaceShips(ws, payload) {
  const room = requireRoom(ws);
  if (!room) return;
  const result = rooms.placeShips(room, ws.role, payload && payload.ships);
  if (!result.success) return sendError(ws, result.error);
  if (result.bothReady) {
    broadcastRoom(room, 'both_ready', { turn: room.turn });
  }
}

function onFire(ws, payload) {
  const room = requireRoom(ws);
  if (!room) return;
  const result = rooms.fire(room, ws.role, payload && payload.idx);
  if (!result.success) return sendError(ws, result.error);
  broadcastRoom(room, 'fire_result', {
    by: ws.role,
    idx: payload.idx,
    result: result.result,
    letter: result.letter,
    shipCells: result.shipCells,
    shipLetters: result.shipLetters,
    shipName: result.shipName,
    coord: result.coord,
    nextTurn: result.nextTurn,
  });
  if (result.gameOver) {
    broadcastRoom(room, 'game_over', { winner: result.winner });
  }
}

function handleLeave(ws) {
  if (!ws.roomCode || !ws.role) return;
  const room = rooms.getRoom(ws.roomCode);
  if (room) {
    const myRole = ws.role;
    const oppRole = rooms.otherRole(myRole);
    room.players[myRole].connected = false;
    room.players[myRole].ws = null;
    const opponent = room.players[oppRole];
    if (opponent.connected) {
      send(opponent.ws, 'opponent_left', {});
      if (room.status === 'battle' || room.status === 'placing') {
        room.status = 'finished';
        room.winner = oppRole;
        send(opponent.ws, 'game_over', { winner: oppRole });
      }
    } else {
      rooms.deleteRoom(room.code);
    }
  }
  ws.roomCode = null;
  ws.role = null;
}

wss.on('connection', (ws) => {
  ws.roomCode = null;
  ws.role = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return sendError(ws, 'Некорректное сообщение');
    }
    const { type, payload } = msg || {};
    switch (type) {
      case 'create_room':
        return onCreateRoom(ws);
      case 'join_room':
        return onJoinRoom(ws, payload);
      case 'place_ships':
        return onPlaceShips(ws, payload);
      case 'fire':
        return onFire(ws, payload);
      case 'leave_room':
        return handleLeave(ws);
      default:
        return sendError(ws, 'Неизвестное событие');
    }
  });

  ws.on('close', () => handleLeave(ws));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Battleship server listening on port ${PORT}`);
});
