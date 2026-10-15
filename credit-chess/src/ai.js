// Computer opponent: alpha-beta search over the credit economy.
// Positions are scored in credits, so material, property and cash trade
// off against each other directly.

import { colorOf, inCheck, opponent, typeOf } from './chess.js';
import { applyMove, availableMoves, propertyAt } from './game.js';

// How many credits a piece on the board is worth to its owner.
const PIECE_WORTH = { p: 3, n: 9, b: 9.5, r: 15, q: 27, k: 0 };
const WIN = 100000;

// depth: full-width plies after the computer's own move; quiet: how many
// further plies of captures to follow so exchanges are seen to the end.
export const LEVELS = {
  easy: { depth: 1, quiet: 0, noise: 6, label: 'Easy' },
  medium: { depth: 1, quiet: 4, noise: 1, label: 'Medium' },
  hard: { depth: 2, quiet: 4, noise: 0, label: 'Hard' },
};

// Cash is worth more when you're running low (under a fifth of the
// starting stake): bankruptcy loses the game.
function cashWorth(c, start) {
  const low = start * 0.2;
  return c < low ? c - (low - c) * 1.5 : c;
}

// Score from `color`'s point of view.
export function evaluate(game, color) {
  const start = game.rules.startingCredits;
  let score = cashWorth(game.credits[color], start) - cashWorth(game.credits[opponent(color)], start);
  game.state.board.forEach((p, sq) => {
    if (!p) return;
    let worth = PIECE_WORTH[typeOf(p)];
    if (typeOf(p) === 'p') worth += 0.15 * (colorOf(p) === 'w' ? (sq >> 3) - 1 : 6 - (sq >> 3));
    score += colorOf(p) === color ? worth : -worth;
  });
  for (const [sq, owner] of Object.entries(game.owners)) {
    const worth = 2 * propertyAt(game, Number(sq)).rent;
    score += owner === color ? worth : -worth;
  }
  return score;
}

// Buy property when at least 30% of the starting stake is left afterwards.
export function wantsToBuy(game, move) {
  return move.canBuy && game.credits[game.state.turn] + move.net - move.buyPrice >= game.rules.startingCredits * 0.3;
}

// Captures and earners first so alpha-beta prunes more.
function ordered(moves) {
  return moves.slice().sort((a, b) => (b.captured ? 10 : 0) + b.net - ((a.captured ? 10 : 0) + a.net));
}

function search(game, depth, quiet, alpha, beta, ply) {
  if (depth === 0 && quiet === 0) return evaluate(game, game.state.turn);
  const moves = availableMoves(game);
  if (moves.length === 0) return inCheck(game.state) ? -WIN + ply : 0;
  let candidates = moves.filter((m) => m.affordable);
  if (candidates.length === 0) return -WIN + ply; // bankrupt

  let best = -Infinity;
  if (depth === 0) {
    // Quiescence: either stand on the current score or keep capturing.
    best = evaluate(game, game.state.turn);
    if (best > alpha) alpha = best;
    if (alpha >= beta) return best;
    candidates = candidates.filter((m) => m.captured);
  }
  for (const m of ordered(candidates)) {
    const score = -search(applyMove(game, m, wantsToBuy(game, m)), Math.max(0, depth - 1), depth ? quiet : quiet - 1, -beta, -alpha, ply + 1);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Pick a move for the side to move. Returns { from, to, promotion?, buy } or null.
export function chooseMove(game, level = 'medium', random = Math.random) {
  const { depth, quiet, noise } = LEVELS[level] ?? LEVELS.medium;
  const moves = availableMoves(game).filter((m) => m.affordable);
  if (!moves.length) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const m of ordered(moves)) {
    const buy = wantsToBuy(game, m);
    const score = -search(applyMove(game, m, buy), depth, quiet, -WIN * 2, WIN * 2, 1) + (random() - 0.5) * noise;
    if (score > bestScore) {
      bestScore = score;
      best = { from: m.from, to: m.to, buy, ...(m.promotion ? { promotion: m.promotion } : {}) };
    }
  }
  return best;
}
