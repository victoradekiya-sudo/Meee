// A game of Credit Chess: chess state + both players' credit balances,
// plus property ownership and bonus squares when those house rules are on.
// Games are immutable; every action returns a new game object.

import {
  colorOf, fromFEN, inCheck, initialState, insufficientMaterial, legalMoves, makeMove,
  opponent, parseSquare, positionKey, squareName, toSAN, typeOf, WHITE, BLACK,
} from './chess.js';
import { DEFAULT_RULES, evaluateMove, PIECE_NAMES } from './credits.js';

export const COLOR_NAMES = { [WHITE]: 'White', [BLACK]: 'Black' };
const capital = (s) => s[0].toUpperCase() + s.slice(1);

// `house` switches on the optional rules: { properties: bool, bonuses: bool }.
export function createGame({ rules = DEFAULT_RULES, fen, credits, house = {} } = {}) {
  const state = fen ? fromFEN(fen) : initialState();
  const options = { properties: Boolean(house.properties), bonuses: Boolean(house.bonuses) };
  const game = {
    rules,
    options,
    state,
    credits: credits ?? { [WHITE]: rules.startingCredits, [BLACK]: rules.startingCredits },
    owners: {},  // property square -> owning color
    bonuses: options.bonuses ? rules.house.bonusSquares.map(parseSquare) : [],
    history: [], // one ledger entry per move
    actions: [], // replayable record: moves and resignations
    positions: { [positionKey(state)]: 1 },
    result: null,
  };
  return { ...game, result: computeResult(game) };
}

// Rebuild a game from its options and recorded actions (used for online play).
// Throws if any action is invalid.
export function replay(house, actions, base = createGame({ house })) {
  return actions.reduce((g, a) => (a.resign ? resign(g, a.resign) : playMove(g, a)), base);
}

// The property on `sq`, if the property house rule is on.
export function propertyAt(game, sq) {
  if (!game.options.properties) return null;
  const name = squareName(sq);
  return game.rules.house.properties.find((p) => p.squares.includes(name)) ?? null;
}

// Full price of a legal move in this game: chess earnings from the price
// list, plus rent and bonus squares from the house rules.
function priceMove(game, move) {
  const color = colorOf(move.piece);
  const ev = evaluateMove(game.state, move, game.rules);
  const charges = [{ kind: 'fee', label: `${capital(PIECE_NAMES[typeOf(move.piece)])} move fee`, amount: ev.cost }];
  const gains = [...ev.gains];

  const property = propertyAt(game, move.to);
  const owner = game.owners[move.to];
  if (property && owner && owner !== color) {
    charges.push({ kind: 'rent', label: `Rent on ${squareName(move.to)}, paid to ${COLOR_NAMES[owner]}`, amount: property.rent });
  }
  if (game.bonuses.includes(move.to)) {
    gains.push({ kind: 'bonus', label: `Bonus square ${squareName(move.to)}`, amount: game.rules.house.bonusAmount });
  }

  const cost = charges.reduce((s, c) => s + c.amount, 0);
  const earned = gains.reduce((s, g) => s + g.amount, 0);
  const net = earned - cost;
  const balance = game.credits[color];
  const buyPrice = property && !owner ? property.price : null;
  return {
    ...move,
    charges,
    gains,
    cost,
    earned,
    net,
    affordable: cost <= balance,
    buyPrice,
    canBuy: buyPrice !== null && cost <= balance && balance + net >= buyPrice,
  };
}

// Legal moves for the side to move, each priced and marked affordable or not.
export function availableMoves(game) {
  return legalMoves(game.state).map((m) => priceMove(game, m));
}

// Apply a priced move: pay fees and rent, collect earnings, optionally buy
// the property landed on. No notation or end-of-game checks; the computer
// player uses this directly while searching.
export function applyMove(game, move, buy = false) {
  const color = colorOf(move.piece);
  const credits = { ...game.credits, [color]: game.credits[color] + move.net - (buy ? move.buyPrice : 0) };
  const rent = move.charges.find((c) => c.kind === 'rent');
  if (rent) credits[opponent(color)] += rent.amount;
  return {
    ...game,
    state: makeMove(game.state, move),
    credits,
    owners: buy ? { ...game.owners, [move.to]: color } : game.owners,
    bonuses: game.bonuses.includes(move.to) ? game.bonuses.filter((s) => s !== move.to) : game.bonuses,
  };
}

// Play a move given as { from, to, promotion?, buy? }. Throws if the move is
// illegal, unaffordable, or the game is over.
export function playMove(game, { from, to, promotion, buy = false }) {
  if (game.result) throw new Error('The game is over.');
  const promoteTo = promotion ?? 'q';
  const move = availableMoves(game).find(
    (m) => m.from === from && m.to === to && (!m.promotion || m.promotion === promoteTo),
  );
  if (!move) throw new Error('Illegal move.');
  if (!move.affordable) throw new Error('Not enough credits for that move.');
  if (buy && !move.canBuy) throw new Error('That property can’t be bought with this move.');

  const color = game.state.turn;
  const next = applyMove(game, move, buy);
  const key = positionKey(next.state);
  const rent = move.charges.find((c) => c.kind === 'rent');
  const action = { from, to };
  if (move.promotion) action.promotion = move.promotion;
  if (buy) action.buy = true;

  const played = {
    ...next,
    positions: { ...game.positions, [key]: (game.positions[key] ?? 0) + 1 },
    actions: [...game.actions, action],
    history: [...game.history, {
      color,
      san: toSAN(game.state, move),
      piece: move.piece,
      from,
      to,
      charges: move.charges,
      gains: move.gains,
      purchase: buy ? move.buyPrice : 0,
      rent: rent ? rent.amount : 0,
      spent: move.cost + (buy ? move.buyPrice : 0),
      earned: move.earned,
      balance: next.credits[color],
    }],
  };
  return { ...played, result: computeResult(played, key) };
}

export function resign(game, color) {
  if (game.result) return game;
  const winner = opponent(color);
  return {
    ...game,
    actions: [...game.actions, { resign: color }],
    result: { winner, reason: 'resignation', text: `${COLOR_NAMES[color]} resigned. ${COLOR_NAMES[winner]} wins.` },
  };
}

// Credits a player has spent and earned so far, including rent received.
export function accountSummary(game, color) {
  let spent = 0;
  let earned = 0;
  for (const h of game.history) {
    if (h.color === color) { spent += h.spent; earned += h.earned; } else earned += h.rent;
  }
  return { spent, earned };
}

// Outcome for the side to move, or null if play continues.
function computeResult(game, key = positionKey(game.state)) {
  const { state } = game;
  const mover = state.turn;
  const winner = opponent(mover);
  const moves = availableMoves(game);

  if (moves.length === 0) {
    return inCheck(state)
      ? { winner, reason: 'checkmate', text: `Checkmate. ${COLOR_NAMES[winner]} wins.` }
      : { winner: null, reason: 'stalemate', text: 'Stalemate. The game is drawn.' };
  }
  if (!moves.some((m) => m.affordable)) {
    const balance = game.credits[mover];
    return {
      winner,
      reason: 'bankruptcy',
      text: `${COLOR_NAMES[mover]} is bankrupt: ${balance} credits can’t pay for any legal move. ${COLOR_NAMES[winner]} wins.`,
    };
  }
  if (state.halfmove >= 100) return { winner: null, reason: 'fifty-move', text: 'Draw by the fifty-move rule.' };
  if ((game.positions[key] ?? 0) >= 3) return { winner: null, reason: 'repetition', text: 'Draw by threefold repetition.' };
  if (insufficientMaterial(state)) return { winner: null, reason: 'material', text: 'Draw: neither side can deliver mate.' };
  return null;
}
