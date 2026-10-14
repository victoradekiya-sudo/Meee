import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSquare as sq } from '../src/chess.js';
import { createGame, playMove, availableMoves, resign, replay, accountSummary } from '../src/game.js';

const play = (game, ...moves) => moves.reduce((g, m) => {
  const [from, to] = [m.slice(0, 2), m.slice(2, 4)];
  return playMove(g, { from: sq(from), to: sq(to), promotion: m[4] });
}, game);

test('both players start with 100 credits', () => {
  const g = createGame();
  assert.deepEqual(g.credits, { w: 100, b: 100 });
  assert.equal(g.result, null);
});

test('moves deduct cost and add earnings for the mover only', () => {
  const g = play(createGame(), 'e2e4', 'g8f6', 'e4e5');
  // White: -1 (e4), -1 +0.5 (e5 threatens the f6 knight). Black: -2 (Nf6).
  assert.deepEqual(g.credits, { w: 98.5, b: 98 });
  assert.equal(g.history.length, 3);
  assert.equal(g.history[2].san, 'e5');
  assert.deepEqual([g.history[2].spent, g.history[2].earned], [1, 0.5]);
  assert.equal(g.history[2].balance, 98.5);
});

test('checkmate ends the game', () => {
  const g = play(createGame(), 'f2f3', 'e7e5', 'g2g4', 'd8h4');
  assert.equal(g.result.reason, 'checkmate');
  assert.equal(g.result.winner, 'b');
  assert.equal(g.history.at(-1).san, 'Qh4#');
  // Queen move costs 8 and the check earns 9.
  assert.equal(g.credits.b, 100 - 1 - 8 + 9);
  assert.throws(() => play(g, 'a2a3'), /over/);
});

test('moves you cannot afford are rejected', () => {
  const g = createGame({ credits: { w: 1.5, b: 100 } });
  const moves = availableMoves(g);
  assert.ok(moves.find((m) => m.from === sq('g1')).affordable === false);
  assert.ok(moves.find((m) => m.from === sq('e2')).affordable === true);
  assert.throws(() => play(g, 'g1f3'), /credits/);
});

test('a player who cannot afford any legal move is bankrupt and loses', () => {
  const g = createGame({ credits: { w: 0.5, b: 100 } });
  assert.equal(g.result.reason, 'bankruptcy');
  assert.equal(g.result.winner, 'b');

  // White spends its last credit on a pawn move, then can't pay for the next one.
  const late = play(createGame({ credits: { w: 1, b: 100 } }), 'a2a3', 'b8c6');
  assert.equal(late.credits.w, 0);
  assert.equal(late.result.reason, 'bankruptcy');
});

test('in check with only unaffordable escapes is bankruptcy', () => {
  // Black king in check from a rook; only king moves escape, but black has 0.5 credits.
  const g = createGame({ fen: '4k3/8/8/8/8/8/8/4R1K1 b - - 0 1', credits: { w: 100, b: 0.5 } });
  assert.equal(g.result.reason, 'bankruptcy');
  assert.equal(g.result.winner, 'w');
});

test('stalemate, threefold repetition and resignation', () => {
  assert.equal(createGame({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' }).result.reason, 'stalemate');
  const rep = play(createGame(), 'g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8');
  assert.equal(rep.result.reason, 'repetition');
  const r = resign(createGame(), 'w');
  assert.equal(r.result.winner, 'b');
});

test('promotion defaults to a queen and honours the chosen piece', () => {
  const fen = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';
  assert.equal(play(createGame({ fen }), 'a7a8').state.board[sq('a8')], 'Q');
  assert.equal(play(createGame({ fen }), 'a7a8n').state.board[sq('a8')], 'N');
});

test('replaying recorded actions rebuilds the same game', () => {
  const g = resign(play(createGame({ house: { properties: true } }), 'e2e4', 'e7e5', 'g1f3'), 'b');
  const copy = replay(g.options, g.actions);
  assert.deepEqual(copy.credits, g.credits);
  assert.deepEqual(copy.result, g.result);
  assert.throws(() => replay({}, [{ from: sq('e2'), to: sq('e5') }]), /Illegal/);
});

const house = { properties: true, bonuses: true };
const playBuy = (g, m) => playMove(g, { from: sq(m.slice(0, 2)), to: sq(m.slice(2, 4)), buy: true });

test('house rules are off by default', () => {
  const g = createGame();
  const move = availableMoves(g).find((m) => m.to === sq('f3'));
  assert.equal(move.buyPrice, null);
  assert.throws(() => playBuy(g, 'g1f3'), /bought/);
});

test('landing on unowned property offers it for sale', () => {
  const g = createGame({ house });
  const move = availableMoves(g).find((m) => m.from === sq('g1') && m.to === sq('f3'));
  assert.equal(move.buyPrice, 4);
  assert.equal(move.canBuy, true);
  const bought = playBuy(g, 'g1f3');
  assert.equal(bought.owners[sq('f3')], 'w');
  assert.equal(bought.credits.w, 100 - 2 - 4);
  assert.equal(bought.history[0].spent, 6);
  // Declining leaves it unowned.
  assert.equal(play(g, 'g1f3').owners[sq('f3')], undefined);
});

test('enemy pieces landing on owned property pay rent to the owner', () => {
  // White owns e4 (Prime: rent 3). Black's pawn captures onto it.
  let g = playBuy(createGame({ house }), 'e2e4');
  assert.equal(g.credits.w, 100 - 1 - 6);
  g = play(g, 'd7d5');
  const capture = availableMoves(play(g, 'a2a3')).find((m) => m.to === sq('e4'));
  assert.equal(capture.cost, 1 + 3);
  g = play(g, 'a2a3', 'd5e4');
  assert.equal(g.credits.b, 100 - 1 - 1 - 3);
  assert.equal(g.credits.w, 100 - 1 - 6 - 1 + 3);
  assert.equal(g.history.at(-1).rent, 3);
  assert.deepEqual(accountSummary(g, 'w'), { spent: 8, earned: 3 });
  // Own pieces never pay rent.
  assert.equal(availableMoves(play(g, 'b1c3', 'a7a6')).find((m) => m.from === sq('c3') && m.to === sq('e4')).cost, 2);
});

test('rent counts towards affordability and bankruptcy', () => {
  // Black owns e5; white has 3 credits, so Nxe5 (fee 2 + rent 3) is unaffordable.
  const fen = '4k3/8/8/4p3/8/5N2/8/4K3 w - - 0 1';
  const g = createGame({ house, fen, credits: { w: 3, b: 100 } });
  const priced = availableMoves({ ...g, owners: { [sq('e5')]: 'b' } }).find((m) => m.to === sq('e5'));
  assert.equal(priced.cost, 5);
  assert.equal(priced.affordable, false);
});

test('bonus squares pay once', () => {
  let g = play(createGame({ house }), 'e2e4', 'e7e5', 'f1b5');
  assert.equal(g.credits.w, 100 - 1 - 2 + 3);
  assert.equal(g.bonuses.includes(sq('b5')), false);
  g = play(g, 'a7a6', 'b5c4', 'a6a5', 'c4b5');
  assert.equal(g.history.at(-1).earned, 0);
});
