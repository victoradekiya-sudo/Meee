import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSquare as sq } from '../src/chess.js';
import { createGame, playMove } from '../src/game.js';
import { chooseMove } from '../src/ai.js';

const noRandom = () => 0.5;

for (const level of ['easy', 'medium', 'hard']) {
  test(`${level}: takes a free queen`, () => {
    const g = createGame({ fen: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1' });
    assert.deepEqual(chooseMove(g, level, noRandom), { from: sq('d1'), to: sq('d5'), buy: false });
  });
}

test('finds mate in one', () => {
  const g = createGame({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' });
  const m = chooseMove(g, 'medium', noRandom);
  assert.equal(playMove(g, m).result.reason, 'checkmate');
});

test('does not grab a pawn defended by a pawn (medium sees the recapture)', () => {
  const g = createGame({ fen: '4k3/8/2p5/3p4/8/8/3Q4/4K3 w - - 0 1' });
  const m = chooseMove(g, 'medium', noRandom);
  assert.notEqual(m.to, sq('d5'));
});

test('always returns a legal, affordable move', () => {
  let g = createGame({ house: { properties: true, bonuses: true } });
  for (let i = 0; i < 12 && !g.result; i++) g = playMove(g, chooseMove(g, 'easy'));
  assert.ok(g.history.length > 0);
});
