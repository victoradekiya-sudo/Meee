import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSquare as sq } from '../src/chess.js';
import { createGame, playMove, availableMoves, resign } from '../src/game.js';

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
  assert.equal(g.history[2].net, -0.5);
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
