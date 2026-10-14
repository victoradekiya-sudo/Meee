// A game of Credit Chess: chess state + both players' credit balances.
// Games are immutable; every action returns a new game object.

import {
  fromFEN, inCheck, initialState, insufficientMaterial, legalMoves, makeMove,
  opponent, positionKey, toSAN, WHITE, BLACK,
} from './chess.js';
import { DEFAULT_RULES, evaluateMove } from './credits.js';

export const COLOR_NAMES = { [WHITE]: 'White', [BLACK]: 'Black' };

export function createGame({ rules = DEFAULT_RULES, fen, credits } = {}) {
  const state = fen ? fromFEN(fen) : initialState();
  const game = {
    rules,
    state,
    credits: credits ?? { [WHITE]: rules.startingCredits, [BLACK]: rules.startingCredits },
    history: [],
    positions: { [positionKey(state)]: 1 },
    result: null,
  };
  return { ...game, result: computeResult(game) };
}

// Legal moves for the side to move, each annotated with its credit
// evaluation and whether the player can afford it.
export function availableMoves(game) {
  const balance = game.credits[game.state.turn];
  return legalMoves(game.state).map((m) => {
    const ev = evaluateMove(game.state, m, game.rules);
    return { ...m, ...ev, affordable: ev.cost <= balance };
  });
}

// Play a move given as { from, to, promotion? }. Throws if the move is
// illegal, unaffordable, or the game is over.
export function playMove(game, { from, to, promotion }) {
  if (game.result) throw new Error('The game is over.');
  const promoteTo = promotion ?? 'q';
  const move = availableMoves(game).find(
    (m) => m.from === from && m.to === to && (!m.promotion || m.promotion === promoteTo),
  );
  if (!move) throw new Error('Illegal move.');
  if (!move.affordable) throw new Error('Not enough credits for that move.');

  const color = game.state.turn;
  const state = makeMove(game.state, move);
  const credits = { ...game.credits, [color]: game.credits[color] + move.net };
  const key = positionKey(state);
  const next = {
    ...game,
    state,
    credits,
    positions: { ...game.positions, [key]: (game.positions[key] ?? 0) + 1 },
    history: [...game.history, {
      color,
      san: toSAN(game.state, move),
      piece: move.piece,
      from: move.from,
      to: move.to,
      cost: move.cost,
      gains: move.gains,
      net: move.net,
      balance: credits[color],
    }],
  };
  return { ...next, result: computeResult(next, key) };
}

export function resign(game, color) {
  if (game.result) return game;
  const winner = opponent(color);
  return { ...game, result: { winner, reason: 'resignation', text: `${COLOR_NAMES[color]} resigned. ${COLOR_NAMES[winner]} wins.` } };
}

// Outcome for the side to move, or null if play continues.
function computeResult(game, key = positionKey(game.state)) {
  const { state } = game;
  const mover = state.turn;
  const winner = opponent(mover);
  const legal = legalMoves(state);

  if (legal.length === 0) {
    return inCheck(state)
      ? { winner, reason: 'checkmate', text: `Checkmate. ${COLOR_NAMES[winner]} wins.` }
      : { winner: null, reason: 'stalemate', text: 'Stalemate. The game is drawn.' };
  }
  const balance = game.credits[mover];
  if (!legal.some((m) => evaluateMove(state, m, game.rules).cost <= balance)) {
    return {
      winner,
      reason: 'bankruptcy',
      text: `${COLOR_NAMES[mover]} is bankrupt: ${balance} credits can't pay for any legal move. ${COLOR_NAMES[winner]} wins.`,
    };
  }
  if (state.halfmove >= 100) return { winner: null, reason: 'fifty-move', text: 'Draw by the fifty-move rule.' };
  if ((game.positions[key] ?? 0) >= 3) return { winner: null, reason: 'repetition', text: 'Draw by threefold repetition.' };
  if (insufficientMaterial(state)) return { winner: null, reason: 'material', text: 'Draw: neither side can deliver mate.' };
  return null;
}
