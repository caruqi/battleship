const SHIP_DEFS = [
  { size: 4, name: 'Линкор', count: 1 },
  { size: 3, name: 'Крейсер', count: 2 },
  { size: 2, name: 'Эсминец', count: 3 },
  { size: 1, name: 'Катер', count: 4 },
];
const FULL_SHIP_LIST = SHIP_DEFS.flatMap((d) => Array.from({ length: d.count }, () => ({ size: d.size, name: d.name })));

const app = document.getElementById('app');

let S = {
  phase: 'lobby', // lobby, waiting, placing, battle, finished
  role: null, // host | guest
  code: null,
  err: '',
  connState: 'connecting', // connecting | open | closed
  board: new Array(100).fill(0), // own board: shipId per cell, 0 = empty
  ships: [], // own ships {id,size,name,cells,hits,sunk}
  incoming: new Array(100).fill(null), // shots received on own board
  orientation: 'H',
  armedIdx: 0,
  placementQueue: [],
  hoverPreview: [],
  readySent: false,
  turn: null,
  status: null,
  winner: null,
  log: [],
  oppIncoming: new Array(100).fill(null), // my shots against enemy board
  busy: false,
};

function resetPlacement() {
  S.board = new Array(100).fill(0);
  S.ships = [];
  S.placementQueue = FULL_SHIP_LIST.map((s) => ({ ...s }));
  S.armedIdx = 0;
  S.orientation = 'H';
  S.readySent = false;
}
resetPlacement();

function labelOf(idx) {
  const r = Math.floor(idx / 10);
  const c = idx % 10;
  return String.fromCharCode(65 + c) + (r + 1);
}

// ---------- WebSocket ----------
let ws = null;

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(proto + location.host);
  ws.onopen = () => { S.connState = 'open'; render(); };
  ws.onclose = () => {
    S.connState = 'closed';
    if (S.phase !== 'lobby') S.err = 'Соединение с сервером потеряно';
    render();
  };
  ws.onerror = () => {};
  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { return; }
    handleServerMessage(msg.type, msg.payload || {});
  };
}
connectWS();

function wsSend(type, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

function handleServerMessage(type, payload) {
  if (type === 'room_created') {
    S.code = payload.code;
    S.role = payload.role;
    S.phase = 'waiting';
    S.err = '';
    return render();
  }
  if (type === 'room_joined') {
    S.code = payload.code;
    S.role = payload.role;
    S.phase = 'placing';
    S.err = '';
    return render();
  }
  if (type === 'opponent_joined') {
    if (S.phase === 'waiting') { S.phase = 'placing'; }
    return render();
  }
  if (type === 'both_ready') {
    S.turn = payload.turn;
    S.status = 'battle';
    S.phase = 'battle';
    S.err = '';
    return render();
  }
  if (type === 'fire_result') {
    const { by, idx, result, shipCells, shipName, coord, nextTurn } = payload;
    if (by === S.role) {
      S.oppIncoming[idx] = result === 'sunk' ? 'sunk' : result;
      if (shipCells) shipCells.forEach((c) => { S.oppIncoming[c] = 'sunk'; });
    } else {
      S.incoming[idx] = result === 'miss' ? 'miss' : 'hit';
      if (shipCells) {
        shipCells.forEach((c) => { S.incoming[c] = 'hit'; });
        const ship = S.ships.find((s) => s.cells.includes(idx));
        if (ship) ship.sunk = true;
      }
    }
    S.turn = nextTurn;
    S.log.push({ by, coord, result, shipName });
    S.busy = false;
    return render();
  }
  if (type === 'game_over') {
    S.winner = payload.winner;
    S.status = 'finished';
    S.phase = 'finished';
    return render();
  }
  if (type === 'opponent_left') {
    if (S.phase !== 'finished') S.err = 'Соперник отключился';
    return render();
  }
  if (type === 'error') {
    S.err = payload.message || 'Ошибка';
    S.busy = false;
    if (S.phase === 'placing') S.readySent = false;
    return render();
  }
}

// ---------- render ----------
function render() {
  if (S.phase === 'lobby') return renderLobby();
  if (S.phase === 'waiting') return renderWaiting();
  if (S.phase === 'placing') return renderPlacing();
  if (S.phase === 'battle') return renderBattle();
  if (S.phase === 'finished') return renderFinished();
}

function connStatusHtml() {
  if (S.connState === 'open') return '';
  const bad = S.connState === 'closed';
  return `<div class="conn-status ${bad ? 'bad' : ''}">${bad ? 'нет соединения с сервером' : 'подключение...'}</div>`;
}

function renderLobby() {
  app.innerHTML = `
    ${connStatusHtml()}
    <div class="panel center-col">
      <div class="msg" style="margin-bottom:18px;">Классический морской бой на два игрока.<br>Создайте комнату и отправьте код другу — либо введите код, который прислали вам.</div>
      <button class="btn" data-act="create" ${S.connState !== 'open' ? 'disabled' : ''}>Создать комнату</button>
      <div class="divider">ИЛИ</div>
      <label class="label">Код комнаты</label>
      <input class="field" id="joinCode" maxlength="4" placeholder="XXXX" autocomplete="off">
      <button class="btn amber" data-act="join" ${S.connState !== 'open' ? 'disabled' : ''}>Войти по коду</button>
      <div class="err">${S.err}</div>
    </div>
    <div class="footnote">Партия ведётся через сервер — держите вкладку открытой во время игры.</div>
  `;
  app.querySelector('#joinCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
}

function renderWaiting() {
  app.innerHTML = `
    <div class="panel center-col" style="text-align:center;">
      <div class="label">Код вашей комнаты</div>
      <div class="code-display">${S.code}</div>
      <div class="copy-code"><button class="btn ghost small" data-act="copy">Скопировать код</button></div>
      <div class="radar-wait"></div>
      <div class="msg">Ожидание второго игрока...<br>Отправьте код другу, чтобы он ввёл его на этой же странице.</div>
    </div>
  `;
}

function renderPlacing() {
  const allPlaced = S.placementQueue.length === 0;
  const armedShip = S.placementQueue[S.armedIdx] || S.placementQueue[0] || null;
  const trayGroups = SHIP_DEFS.map((def) => {
    const placedOfSize = S.ships.filter((s) => s.size === def.size).length;
    let chips = '';
    for (let i = 0; i < def.count; i++) {
      const used = i < placedOfSize;
      const isArmed = !used && i === placedOfSize && armedShip && armedShip.size === def.size;
      chips += `<div class="ship-chip ${used ? 'used' : ''} ${isArmed ? 'armed' : ''}" data-act="${used ? '' : 'arm'}" data-size="${def.size}">${Array.from({ length: def.size }).map(() => '<div class="seg"></div>').join('')}</div>`;
    }
    return chips;
  }).join('<div style="width:100%;height:0;"></div>');

  app.innerHTML = `
    <div class="panel">
      <div class="board-title active" style="margin-bottom:14px;">Расстановка кораблей</div>
      <div style="max-width:400px;margin:0 auto;">
        <div class="grid-outer">${gridHtml('place')}</div>
        <div class="fleet-tray">${trayGroups}</div>
        <div class="row" style="margin-top:10px;">
          <button class="btn ghost" data-act="rotate" ${S.readySent ? 'disabled' : ''}>Повернуть (${S.orientation === 'H' ? '→' : '↓'})</button>
          <button class="btn ghost" data-act="random" ${S.readySent ? 'disabled' : ''}>Случайно</button>
          <button class="btn ghost" data-act="clear" ${S.readySent ? 'disabled' : ''}>Сбросить</button>
        </div>
        <button class="btn amber" style="margin-top:10px;" data-act="ready" ${allPlaced && !S.readySent ? '' : 'disabled'}>Готов к бою</button>
        ${S.readySent ? '<div class="msg" style="margin-top:10px;">Ожидание готовности соперника...</div>' : ''}
        <div class="err">${S.err}</div>
      </div>
    </div>
  `;
}

function gridHtml(mode, clickable) {
  let html = `<div class="grid" id="mainGrid">`;
  html += `<div class="cell-label"></div>`;
  for (let c = 0; c < 10; c++) html += `<div class="cell-label">${String.fromCharCode(65 + c)}</div>`;
  for (let r = 0; r < 10; r++) {
    html += `<div class="cell-label">${r + 1}</div>`;
    for (let c = 0; c < 10; c++) {
      const idx = r * 10 + c;
      let cls = 'cell';
      if (mode === 'place') {
        if (S.board[idx] > 0) cls += ' ship';
        if (S.hoverPreview.includes(idx)) cls += S.hoverPreview.valid ? ' preview-ok' : ' preview-bad';
        if (!S.readySent) cls += ' clickable';
      } else if (mode === 'own') {
        if (S.board[idx] > 0) cls += ' ship';
        if (S.incoming[idx] === 'hit') cls += ' hit';
        if (S.incoming[idx] === 'miss') cls += ' miss';
        const sunkShip = S.ships.find((s) => s.cells.includes(idx) && s.sunk);
        if (sunkShip) cls += ' sunk';
      } else if (mode === 'enemy') {
        if (S.oppIncoming[idx] === 'hit') cls += ' hit';
        if (S.oppIncoming[idx] === 'sunk') cls += ' sunk';
        if (S.oppIncoming[idx] === 'miss') cls += ' miss';
        if (clickable && S.oppIncoming[idx] == null) cls += ' clickable';
      }
      html += `<div class="${cls}" data-idx="${idx}" data-mode="${mode}"></div>`;
    }
  }
  html += `</div>`;
  return html;
}

function renderBattle() {
  const myTurn = S.turn === S.role && S.status === 'battle';
  const logHtml = (S.log.slice(-12)).map((e) => {
    const who = e.by === S.role ? 'ВЫ' : 'ПРОТИВНИК';
    let cls = 'miss-line', txt = `${who} · ${e.coord} · мимо`;
    if (e.result === 'hit') { cls = 'hit-line'; txt = `${who} · ${e.coord} · попадание!`; }
    if (e.result === 'sunk') { cls = 'sunk-line'; txt = `${who} · ${e.coord} · потоплен ${e.shipName}!`; }
    return `<div class="${cls}">${txt}</div>`;
  }).join('') || '<div style="opacity:0.5;">Бой начинается...</div>';

  app.innerHTML = `
    <div class="turn-banner ${myTurn ? 'mine' : 'theirs'}">${myTurn ? 'Ваш ход — выберите цель' : 'Ход противника'}</div>
    <div class="boards">
      <div class="board-block">
        <div class="board-title">Ваш флот</div>
        <div class="grid-outer">${gridHtml('own')}</div>
      </div>
      <div class="board-block">
        <div class="board-title ${myTurn ? 'active' : ''}">Вражеские воды</div>
        <div class="grid-outer">
          ${gridHtml('enemy', myTurn)}
          <div class="radar-overlay"></div>
        </div>
      </div>
    </div>
    <div class="log">
      <div class="log-title">Судовой журнал</div>
      ${logHtml}
    </div>
  `;
}

function renderFinished() {
  const iWon = S.winner === S.role;
  app.innerHTML = `
    <div class="panel result-banner ${iWon ? 'win' : 'lose'}">
      <h2>${iWon ? 'Победа' : 'Поражение'}</h2>
      <div class="msg">${iWon ? 'Вражеский флот уничтожен.' : 'Ваш флот уничтожен.'}</div>
      <button class="btn amber" style="max-width:240px;margin:20px auto 0;" data-act="rematch">Новая игра</button>
    </div>
  `;
}

render();

// ---------- events ----------
app.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (t) {
    const act = t.dataset.act;
    if (act === 'create') return doCreate();
    if (act === 'join') return doJoin();
    if (act === 'copy') return doCopy();
    if (act === 'rotate') { S.orientation = S.orientation === 'H' ? 'V' : 'H'; return render(); }
    if (act === 'random') return doRandom();
    if (act === 'clear') { resetPlacement(); return render(); }
    if (act === 'ready') return doReady();
    if (act === 'rematch') return doRematch();
    if (act === 'arm') {
      const size = parseInt(t.dataset.size, 10);
      const i = S.placementQueue.findIndex((q) => q.size === size);
      if (i >= 0) { S.armedIdx = i; render(); }
      return;
    }
  }
  const cell = e.target.closest('.cell');
  if (cell) {
    const idx = parseInt(cell.dataset.idx, 10);
    const mode = cell.dataset.mode;
    if (mode === 'place' && !S.readySent) return placeAt(idx);
    if (mode === 'enemy') return fireAt(idx);
  }
});
app.addEventListener('mouseover', (e) => {
  const cell = e.target.closest('.cell[data-mode="place"]');
  if (!cell || S.readySent) return;
  const idx = parseInt(cell.dataset.idx, 10);
  updatePreview(idx);
});
app.addEventListener('mouseleave', (e) => {
  if (e.target.id === 'app') { S.hoverPreview = []; }
}, true);

// ---------- placement logic ----------
function shipCells(idx, size, orientation) {
  const r0 = Math.floor(idx / 10), c0 = idx % 10;
  const cells = [];
  for (let i = 0; i < size; i++) {
    const r = orientation === 'H' ? r0 : r0 + i;
    const c = orientation === 'H' ? c0 + i : c0;
    if (r > 9 || c > 9) return null;
    cells.push(r * 10 + c);
  }
  return cells;
}
function canPlace(cells) {
  if (!cells) return false;
  for (const idx of cells) {
    if (S.board[idx] > 0) return false;
    const r = Math.floor(idx / 10), c = idx % 10;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr > 9 || nc < 0 || nc > 9) continue;
      if (S.board[nr * 10 + nc] > 0 && !cells.includes(nr * 10 + nc)) return false;
    }
  }
  return true;
}
function updatePreview(idx) {
  if (S.placementQueue.length === 0) { S.hoverPreview = []; return; }
  const cur = S.placementQueue[S.armedIdx] || S.placementQueue[0];
  const cells = shipCells(idx, cur.size, S.orientation);
  const valid = canPlace(cells);
  S.hoverPreview = cells || [];
  S.hoverPreview.valid = valid;
  const grid = document.getElementById('mainGrid');
  if (!grid) return;
  grid.querySelectorAll('.cell').forEach((c) => c.classList.remove('preview-ok', 'preview-bad'));
  (cells || []).forEach((i) => {
    const el = grid.querySelector(`.cell[data-idx="${i}"]`);
    if (el) el.classList.add(valid ? 'preview-ok' : 'preview-bad');
  });
}
function placeAt(idx) {
  if (S.placementQueue.length === 0) return;
  if (S.armedIdx >= S.placementQueue.length) S.armedIdx = 0;
  const cur = S.placementQueue[S.armedIdx];
  const cells = shipCells(idx, cur.size, S.orientation);
  if (!canPlace(cells)) { S.err = 'Нельзя разместить здесь корабль'; render(); return; }
  const shipId = S.ships.length + 1;
  cells.forEach((c) => S.board[c] = shipId);
  S.ships.push({ id: shipId, size: cur.size, name: cur.name, cells, hits: 0, sunk: false });
  S.placementQueue.splice(S.armedIdx, 1);
  S.armedIdx = 0;
  S.err = '';
  render();
}
function doRandom() {
  for (let attempt = 0; attempt < 400; attempt++) {
    const board = new Array(100).fill(0);
    const ships = [];
    let ok = true;
    for (const def of FULL_SHIP_LIST) {
      let placed = false;
      for (let tries = 0; tries < 200; tries++) {
        const orientation = Math.random() < 0.5 ? 'H' : 'V';
        const idx = Math.floor(Math.random() * 100);
        const r0 = Math.floor(idx / 10), c0 = idx % 10;
        const cells = []; let bad = false;
        for (let i = 0; i < def.size; i++) {
          const r = orientation === 'H' ? r0 : r0 + i;
          const c = orientation === 'H' ? c0 + i : c0;
          if (r > 9 || c > 9) { bad = true; break; }
          cells.push(r * 10 + c);
        }
        if (bad) continue;
        let validLocal = true;
        for (const cidx of cells) {
          if (board[cidx] > 0) { validLocal = false; break; }
          const r = Math.floor(cidx / 10), c = cidx % 10;
          for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr > 9 || nc < 0 || nc > 9) continue;
            if (board[nr * 10 + nc] > 0 && !cells.includes(nr * 10 + nc)) { validLocal = false; }
          }
        }
        if (!validLocal) continue;
        const shipId = ships.length + 1;
        cells.forEach((cc) => board[cc] = shipId);
        ships.push({ id: shipId, size: def.size, name: def.name, cells, hits: 0, sunk: false });
        placed = true;
        break;
      }
      if (!placed) { ok = false; break; }
    }
    if (ok) { S.board = board; S.ships = ships; S.placementQueue = []; S.armedIdx = 0; render(); return; }
  }
  S.err = 'Не удалось расставить, попробуйте ещё раз';
  render();
}

// ---------- network flow ----------
function doCreate() {
  wsSend('create_room', {});
}
function doJoin() {
  const input = document.getElementById('joinCode');
  const code = input.value.trim().toUpperCase();
  if (code.length !== 4) { S.err = 'Введите 4-значный код'; render(); return; }
  wsSend('join_room', { code });
}
function doCopy() {
  try { navigator.clipboard.writeText(S.code); } catch (e) {}
}
function doReady() {
  if (S.placementQueue.length > 0 || S.readySent) return;
  S.readySent = true;
  S.err = '';
  wsSend('place_ships', { code: S.code, ships: S.ships.map((s) => ({ cells: s.cells })) });
  render();
}
function fireAt(idx) {
  if (S.busy) return;
  if (!(S.turn === S.role && S.status === 'battle')) return;
  if (S.oppIncoming[idx] != null) return;
  S.busy = true;
  wsSend('fire', { code: S.code, idx });
}
function doRematch() {
  wsSend('leave_room', { code: S.code });
  S = {
    ...S,
    phase: 'lobby', role: null, code: null, err: '',
    incoming: new Array(100).fill(null),
    oppIncoming: new Array(100).fill(null),
    turn: null, status: null, winner: null, log: [], busy: false,
  };
  resetPlacement();
  render();
}
