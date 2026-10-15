// The credit economy: what each move costs and what it earns.
// Every number lives in RULES so the balance can be tuned in one place.

import {
  attackedSquares, colorOf, findKing, makeMove, opponent, pawnAttacks, typeOf,
} from './chess.js';

export const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const DEFAULT_RULES = {
  startingCredits: 50,
  pieces: {
    // value: what the piece is worth when captured (and its rank).
    // moveCost: credits burned every time the piece moves.
    // checkBonus: credits earned when this piece's move puts the king in check.
    p: { value: 1, moveCost: 1 },
    n: { value: 3, moveCost: 2, checkBonus: 3 },
    b: { value: 3, moveCost: 2, checkBonus: 3 },
    r: { value: 5, moveCost: 4, checkBonus: 5 },
    q: { value: 9, moveCost: 8, checkBonus: 9 },
    k: { value: null, moveCost: 1 },
  },
  pawn: {
    threatBonus: 0.5,        // pawn lands attacking a higher-ranked piece
    higherCaptureShare: 0.5, // pawn captures a higher-ranked piece: earns this share of its value
  },
  // Optional Monopoly-style house rules, switched on per game.
  house: {
    // Property: the first player to land a piece on one may buy it. Any
    // enemy piece that later ends a move there pays the owner rent.
    properties: [
      { group: 'Prime', squares: ['d4', 'e4', 'd5', 'e5'], price: 6, rent: 3 },
      { group: 'Outpost', squares: ['c3', 'f3', 'c6', 'f6'], price: 4, rent: 2 },
    ],
    // Bonus squares pay out once, to the first piece that lands on them.
    bonusSquares: ['b4', 'g4', 'b5', 'g5'],
    bonusAmount: 3,
  },
};

// Rank used for "higher-ranked" comparisons; the king outranks everything.
function rankOf(type, rules) {
  return type === 'k' ? Infinity : rules.pieces[type].value;
}

// Cost and earnings of a legal move, before it is played.
// Returns { cost, gains: [{ kind, label, amount }], earned, net }.
export function evaluateMove(state, move, rules = DEFAULT_RULES) {
  const mover = typeOf(move.piece);
  const color = colorOf(move.piece);
  const cost = rules.pieces[mover].moveCost;
  const gains = [];
  const after = makeMove(state, move);
  const capturedType = move.captured ? typeOf(move.captured) : null;

  if (mover === 'p') {
    if (capturedType && rankOf(capturedType, rules) > rankOf('p', rules)) {
      gains.push({
        kind: 'capture',
        label: `Pawn took a ${PIECE_NAMES[capturedType]}`,
        amount: rules.pieces[capturedType].value * rules.pawn.higherCaptureShare,
      });
    }
    // Use the pawn's attack pattern even if it just promoted: a pawn on the
    // last rank attacks nothing, so promotions never earn the threat bonus.
    const threatened = pawnAttacks(move.to, color)
      .map((s) => after.board[s])
      .filter((p) => p && colorOf(p) !== color && rankOf(typeOf(p), rules) > rankOf('p', rules));
    if (threatened.length) {
      gains.push({
        kind: 'threat',
        label: `Pawn threatens a ${threatened.map((p) => PIECE_NAMES[typeOf(p)]).join(' and ')}`,
        amount: rules.pawn.threatBonus,
      });
    }
  } else if (mover !== 'k') {
    if (capturedType) {
      gains.push({
        kind: 'capture',
        label: `Captured a ${PIECE_NAMES[capturedType]}`,
        amount: rules.pieces[capturedType].value,
      });
    }
    const enemyKing = findKing(after.board, opponent(color));
    if (attackedSquares(after.board, move.to).includes(enemyKing)) {
      gains.push({
        kind: 'check',
        label: `Check by ${PIECE_NAMES[mover]}`,
        amount: rules.pieces[mover].checkBonus,
      });
    }
  }

  const earned = gains.reduce((sum, g) => sum + g.amount, 0);
  return { cost, gains, earned, net: earned - cost };
}
