// Standard chess rules: board representation, move generation, legality,
// check detection and draw conditions. Pure functions, no DOM.
//
// Board: array of 64 squares, index = rank * 8 + file (a1 = 0, h8 = 63).
// Pieces are FEN letters: uppercase = white, lowercase = black, null = empty.

export const WHITE = 'w';
export const BLACK = 'b';
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const FILES = 'abcdefgh';
const KNIGHT_STEPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_STEPS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const QUEEN_DIRS = [...ROOK_DIRS, ...BISHOP_DIRS];

export const fileOf = (s) => s & 7;
export const rankOf = (s) => s >> 3;
export const squareName = (s) => FILES[fileOf(s)] + (rankOf(s) + 1);
export const parseSquare = (name) => (Number(name[1]) - 1) * 8 + FILES.indexOf(name[0]);
export const colorOf = (p) => (p === p.toUpperCase() ? WHITE : BLACK);
export const typeOf = (p) => p.toLowerCase();
export const opponent = (c) => (c === WHITE ? BLACK : WHITE);

// Square reached from `s` by stepping (df, dr), or -1 if off the board.
function offset(s, df, dr) {
  const f = fileOf(s) + df;
  const r = rankOf(s) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}

export function fromFEN(fen) {
  const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
  const board = new Array(64).fill(null);
  placement.split('/').forEach((row, i) => {
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) file += Number(ch);
      else board[(7 - i) * 8 + file++] = ch;
    }
  });
  return {
    board,
    turn,
    castling: castling === '-' ? '' : castling,
    ep: !ep || ep === '-' ? null : parseSquare(ep),
    halfmove: Number(half ?? 0),
    fullmove: Number(full ?? 1),
  };
}

export function toFEN(state) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = state.board[r * 8 + f];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p;
    }
    rows.push(empty ? row + empty : row);
  }
  const ep = state.ep === null ? '-' : squareName(state.ep);
  return `${rows.join('/')} ${state.turn} ${state.castling || '-'} ${ep} ${state.halfmove} ${state.fullmove}`;
}

export const initialState = () => fromFEN(START_FEN);

// Squares a pawn of `color` on `from` attacks (diagonally forward).
export function pawnAttacks(from, color) {
  const dr = color === WHITE ? 1 : -1;
  return [offset(from, -1, dr), offset(from, 1, dr)].filter((s) => s >= 0);
}

// Squares the piece on `from` attacks (includes squares holding own pieces).
export function attackedSquares(board, from) {
  const p = board[from];
  if (!p) return [];
  const t = typeOf(p);
  if (t === 'p') return pawnAttacks(from, colorOf(p));
  if (t === 'n' || t === 'k') {
    return (t === 'n' ? KNIGHT_STEPS : KING_STEPS)
      .map(([df, dr]) => offset(from, df, dr))
      .filter((s) => s >= 0);
  }
  const dirs = t === 'b' ? BISHOP_DIRS : t === 'r' ? ROOK_DIRS : QUEEN_DIRS;
  const out = [];
  for (const [df, dr] of dirs) {
    let s = from;
    while ((s = offset(s, df, dr)) >= 0) {
      out.push(s);
      if (board[s]) break;
    }
  }
  return out;
}

export function isSquareAttacked(board, target, byColor) {
  for (let s = 0; s < 64; s++) {
    const p = board[s];
    if (p && colorOf(p) === byColor && attackedSquares(board, s).includes(target)) return true;
  }
  return false;
}

export function findKing(board, color) {
  return board.indexOf(color === WHITE ? 'K' : 'k');
}

export function inCheck(state, color = state.turn) {
  const k = findKing(state.board, color);
  return k >= 0 && isSquareAttacked(state.board, k, opponent(color));
}

const CASTLES = {
  K: { king: 4, kingTo: 6, rook: 7, rookTo: 5, empty: [5, 6], safe: [4, 5, 6] },
  Q: { king: 4, kingTo: 2, rook: 0, rookTo: 3, empty: [1, 2, 3], safe: [4, 3, 2] },
  k: { king: 60, kingTo: 62, rook: 63, rookTo: 61, empty: [61, 62], safe: [60, 61, 62] },
  q: { king: 60, kingTo: 58, rook: 56, rookTo: 59, empty: [57, 58, 59], safe: [60, 59, 58] },
};

function pseudoMoves(state) {
  const { board, turn } = state;
  const moves = [];
  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (!p || colorOf(p) !== turn) continue;

    if (typeOf(p) === 'p') {
      const dr = turn === WHITE ? 1 : -1;
      const lastRank = turn === WHITE ? 7 : 0;
      const add = (to, captured, extra = {}) => {
        if (rankOf(to) === lastRank) {
          for (const promotion of ['q', 'r', 'b', 'n']) moves.push({ from, to, piece: p, captured, promotion });
        } else {
          moves.push({ from, to, piece: p, captured, ...extra });
        }
      };
      const one = offset(from, 0, dr);
      if (one >= 0 && !board[one]) {
        add(one, null);
        const two = offset(from, 0, 2 * dr);
        if (rankOf(from) === (turn === WHITE ? 1 : 6) && !board[two]) add(two, null, { double: true });
      }
      for (const to of pawnAttacks(from, turn)) {
        if (board[to] && colorOf(board[to]) !== turn) add(to, board[to]);
        else if (to === state.ep) add(to, turn === WHITE ? 'p' : 'P', { enPassant: true });
      }
      continue;
    }

    for (const to of attackedSquares(board, from)) {
      const q = board[to];
      if (!q) moves.push({ from, to, piece: p, captured: null });
      else if (colorOf(q) !== turn) moves.push({ from, to, piece: p, captured: q });
    }

    if (typeOf(p) === 'k') {
      for (const right of turn === WHITE ? 'KQ' : 'kq') {
        const c = CASTLES[right];
        if (!state.castling.includes(right) || from !== c.king) continue;
        if (board[c.rook] !== (turn === WHITE ? 'R' : 'r')) continue;
        if (c.empty.some((s) => board[s])) continue;
        if (c.safe.some((s) => isSquareAttacked(board, s, opponent(turn)))) continue;
        moves.push({ from, to: c.kingTo, piece: p, captured: null, castle: right });
      }
    }
  }
  return moves;
}

export function makeMove(state, move) {
  const board = state.board.slice();
  const { from, to, piece } = move;
  const color = colorOf(piece);

  board[from] = null;
  board[to] = move.promotion
    ? (color === WHITE ? move.promotion.toUpperCase() : move.promotion)
    : piece;
  if (move.enPassant) board[to + (color === WHITE ? -8 : 8)] = null;
  if (move.castle) {
    const c = CASTLES[move.castle];
    board[c.rookTo] = board[c.rook];
    board[c.rook] = null;
  }

  let castling = state.castling;
  const strip = (rights) => { castling = [...castling].filter((r) => !rights.includes(r)).join(''); };
  if (piece === 'K') strip('KQ');
  if (piece === 'k') strip('kq');
  for (const s of [from, to]) {
    if (s === 0) strip('Q');
    if (s === 7) strip('K');
    if (s === 56) strip('q');
    if (s === 63) strip('k');
  }

  return {
    board,
    turn: opponent(state.turn),
    castling,
    ep: move.double ? (from + to) / 2 : null,
    halfmove: typeOf(piece) === 'p' || move.captured ? 0 : state.halfmove + 1,
    fullmove: state.fullmove + (state.turn === BLACK ? 1 : 0),
  };
}

export function legalMoves(state) {
  return pseudoMoves(state).filter((m) => !inCheck(makeMove(state, m), state.turn));
}

// Key identifying a position for repetition detection. The en-passant square
// only counts when an en-passant capture is actually available.
export function positionKey(state) {
  const epLive = state.ep !== null && legalMoves(state).some((m) => m.enPassant);
  return toFEN({ ...state, ep: epLive ? state.ep : null, halfmove: 0, fullmove: 0 })
    .split(' ').slice(0, 4).join(' ');
}

export function insufficientMaterial(state) {
  const pieces = [];
  state.board.forEach((p, s) => { if (p && typeOf(p) !== 'k') pieces.push({ t: typeOf(p), s }); });
  if (pieces.length === 0) return true;
  if (pieces.length === 1 && (pieces[0].t === 'n' || pieces[0].t === 'b')) return true;
  // Only bishops left, all on the same square colour.
  if (pieces.every((x) => x.t === 'b')) {
    const shade = (s) => (fileOf(s) + rankOf(s)) % 2;
    return pieces.every((x) => shade(x.s) === shade(pieces[0].s));
  }
  return false;
}

// Standard algebraic notation for a legal move in `state`.
export function toSAN(state, move) {
  let san;
  if (move.castle) {
    san = move.castle.toLowerCase() === 'k' ? 'O-O' : 'O-O-O';
  } else {
    const t = typeOf(move.piece);
    const dest = squareName(move.to);
    if (t === 'p') {
      san = (move.captured ? FILES[fileOf(move.from)] + 'x' : '') + dest;
      if (move.promotion) san += '=' + move.promotion.toUpperCase();
    } else {
      const rivals = legalMoves(state).filter(
        (m) => m.piece === move.piece && m.to === move.to && m.from !== move.from,
      );
      let dis = '';
      if (rivals.length) {
        const sameFile = rivals.some((m) => fileOf(m.from) === fileOf(move.from));
        const sameRank = rivals.some((m) => rankOf(m.from) === rankOf(move.from));
        if (!sameFile) dis = FILES[fileOf(move.from)];
        else if (!sameRank) dis = String(rankOf(move.from) + 1);
        else dis = squareName(move.from);
      }
      san = t.toUpperCase() + dis + (move.captured ? 'x' : '') + dest;
    }
  }
  const after = makeMove(state, move);
  if (inCheck(after)) san += legalMoves(after).length ? '+' : '#';
  return san;
}
