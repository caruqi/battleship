const { validateFleet } = require('./shipRules');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function genCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function otherRole(role) {
  return role === 'host' ? 'guest' : 'host';
}

function newPlayer() {
  return { ws: null, connected: false, ready: false, board: null, ships: null, incoming: null };
}

function createRoom() {
  const code = genCode();
  const room = {
    code,
    status: 'waiting', // waiting -> placing -> battle -> finished
    turn: null,
    winner: null,
    players: { host: newPlayer(), guest: newPlayer() },
    log: [],
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function deleteRoom(code) {
  rooms.delete(code);
}

function placeShips(room, role, shipsInput) {
  const result = validateFleet(shipsInput);
  if (!result.valid) return { success: false, error: result.error };

  const player = room.players[role];
  player.board = result.board;
  player.ships = result.ships;
  player.incoming = new Array(100).fill(null);
  player.ready = true;

  const opponent = room.players[otherRole(role)];
  const bothReady = player.ready && opponent.ready;
  if (bothReady) {
    room.status = 'battle';
    room.turn = 'host';
  }
  return { success: true, bothReady };
}

function labelOf(idx) {
  const r = Math.floor(idx / 10);
  const c = idx % 10;
  return String.fromCharCode(65 + c) + (r + 1);
}

function fire(room, role, idx) {
  if (room.status !== 'battle') return { success: false, error: 'Бой ещё не начался' };
  if (room.turn !== role) return { success: false, error: 'Сейчас не ваш ход' };
  if (!Number.isInteger(idx) || idx < 0 || idx > 99) return { success: false, error: 'Некорректная клетка' };

  const oppRole = otherRole(role);
  const opponent = room.players[oppRole];
  if (!opponent.board || !opponent.incoming) return { success: false, error: 'Соперник ещё не готов' };
  if (opponent.incoming[idx] != null) return { success: false, error: 'По этой клетке уже стреляли' };

  const shipId = opponent.board[idx];
  let result = 'miss';
  let sunkShip = null;

  if (shipId > 0) {
    result = 'hit';
    opponent.incoming[idx] = 'hit';
    const ship = opponent.ships.find((s) => s.id === shipId);
    ship.hits = (ship.hits || 0) + 1;
    if (ship.hits >= ship.size) {
      ship.sunk = true;
      sunkShip = ship;
    }
  } else {
    opponent.incoming[idx] = 'miss';
  }

  const coord = labelOf(idx);
  room.log.push({ by: role, coord, result: sunkShip ? 'sunk' : result, shipName: sunkShip ? sunkShip.name : undefined });

  const allSunk = opponent.ships.every((s) => s.sunk);
  let gameOver = false;
  if (allSunk) {
    room.status = 'finished';
    room.winner = role;
    gameOver = true;
  } else {
    room.turn = result === 'hit' ? role : oppRole;
  }

  return {
    success: true,
    result: sunkShip ? 'sunk' : result,
    shipCells: sunkShip ? sunkShip.cells : undefined,
    shipName: sunkShip ? sunkShip.name : undefined,
    nextTurn: room.turn,
    gameOver,
    winner: gameOver ? role : undefined,
    coord,
  };
}

module.exports = { createRoom, getRoom, deleteRoom, placeShips, fire, otherRole, rooms };
