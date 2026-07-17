const SHIP_DEFS = [
  { size: 4, name: 'Линкор', count: 1 },
  { size: 3, name: 'Крейсер', count: 2 },
  { size: 2, name: 'Эсминец', count: 3 },
  { size: 1, name: 'Катер', count: 4 },
];

const EXPECTED_COUNTS = SHIP_DEFS.reduce((acc, d) => { acc[d.size] = d.count; return acc; }, {});
const TOTAL_SHIPS = SHIP_DEFS.reduce((sum, d) => sum + d.count, 0);

function shipName(size) {
  const def = SHIP_DEFS.find((d) => d.size === size);
  return def ? def.name : 'Корабль';
}

function isValidLine(cells) {
  if (!Array.isArray(cells) || cells.length < 1 || cells.length > 4) return false;
  const uniq = new Set(cells);
  if (uniq.size !== cells.length) return false;
  for (const c of cells) {
    if (!Number.isInteger(c) || c < 0 || c > 99) return false;
  }
  if (cells.length === 1) return true;

  const sorted = [...cells].sort((a, b) => a - b);
  const rows = sorted.map((i) => Math.floor(i / 10));
  const cols = sorted.map((i) => i % 10);
  const sameRow = rows.every((r) => r === rows[0]);
  const sameCol = cols.every((c) => c === cols[0]);

  if (sameRow) {
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] !== 1) return false;
    }
    return true;
  }
  if (sameCol) {
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] !== 10) return false;
    }
    return true;
  }
  return false;
}

function validateFleet(shipsInput) {
  if (!Array.isArray(shipsInput) || shipsInput.length !== TOTAL_SHIPS) {
    return { valid: false, error: 'Неверное количество кораблей' };
  }

  const counts = {};
  for (const size of Object.keys(EXPECTED_COUNTS)) counts[size] = 0;

  const board = new Array(100).fill(0);
  const ships = [];

  for (let i = 0; i < shipsInput.length; i++) {
    const cells = shipsInput[i] && shipsInput[i].cells;
    if (!isValidLine(cells)) {
      return { valid: false, error: 'Некорректная форма корабля' };
    }
    const size = cells.length;
    if (!(size in EXPECTED_COUNTS)) {
      return { valid: false, error: 'Недопустимый размер корабля' };
    }
    counts[size]++;
    for (const idx of cells) {
      if (board[idx] !== 0) return { valid: false, error: 'Корабли пересекаются' };
    }
    const shipId = i + 1;
    for (const idx of cells) board[idx] = shipId;
    const lettersRaw = shipsInput[i] && shipsInput[i].letters;
    const letters = Array.isArray(lettersRaw) && lettersRaw.length === cells.length
      ? lettersRaw.map((l) => (typeof l === 'string' ? l.slice(0, 2) : ''))
      : cells.map(() => '');
    ships.push({ id: shipId, size, name: shipName(size), cells: [...cells], letters, hits: 0, sunk: false });
  }

  for (const size of Object.keys(EXPECTED_COUNTS)) {
    if (counts[size] !== EXPECTED_COUNTS[size]) {
      return { valid: false, error: 'Неверный состав флота' };
    }
  }

  for (const ship of ships) {
    for (const idx of ship.cells) {
      const r = Math.floor(idx / 10);
      const c = idx % 10;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr > 9 || nc < 0 || nc > 9) continue;
          const nIdx = nr * 10 + nc;
          if (board[nIdx] !== 0 && board[nIdx] !== ship.id) {
            return { valid: false, error: 'Корабли не могут соприкасаться' };
          }
        }
      }
    }
  }

  return { valid: true, board, ships };
}

module.exports = { SHIP_DEFS, TOTAL_SHIPS, validateFleet, shipName };
