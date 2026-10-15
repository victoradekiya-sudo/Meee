import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromFEN, legalMoves, parseSquare, START_FEN } from '../src/chess.js';
import { DEFAULT_RULES, evaluateMove } from '../src/credits.js';

function evaluate(fen, from, to, rules) {
  const state = fromFEN(fen);
  const move = legalMoves(state).find((m) => m.from === parseSquare(from) && m.to === parseSquare(to)
    && (!m.promotion || m.promotion === 'q'));
  assert.ok(move, `${from}-${to} should be legal`);
  return evaluateMove(state, move, rules);
}
const kinds = (ev) => ev.gains.map((g) => g.kind);

test('starting credits are 50', () => {
  assert.equal(DEFAULT_RULES.startingCredits, 50);
});

test('plain pawn move costs 1', () => {
  const ev = evaluate(START_FEN, 'e2', 'e4');
  assert.deepEqual([ev.cost, ev.earned, ev.net], [1, 0, -1]);
});

test('pawn threatening a higher-ranked piece earns 0.5', () => {
  const ev = evaluate('4k3/8/5n2/8/4P3/8/8/4K3 w - - 0 1', 'e4', 'e5');
  assert.deepEqual(kinds(ev), ['threat']);
  assert.equal(ev.net, -0.5);
});

test('pawn forking two pieces still earns a single 0.5 threat bonus', () => {
  const ev = evaluate('4k3/8/3b1n2/8/4P3/8/8/4K3 w - - 0 1', 'e4', 'e5');
  assert.equal(ev.earned, 0.5);
});

test('pawn giving check counts as a threat (the king outranks a pawn)', () => {
  const ev = evaluate('8/8/3k4/8/4P3/8/8/4K3 w - - 0 1', 'e4', 'e5');
  assert.deepEqual(kinds(ev), ['threat']);
});

test('pawn threatening only a pawn earns nothing', () => {
  const ev = evaluate('4k3/8/5p2/8/4P3/8/8/4K3 w - - 0 1', 'e4', 'e5');
  assert.equal(ev.earned, 0);
});

test('pawn capturing a higher-ranked piece earns half its value', () => {
  assert.equal(evaluate('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5').earned, 1.5);
  assert.equal(evaluate('4k3/8/8/3r4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5').earned, 2.5);
  assert.equal(evaluate('4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5').earned, 4.5);
});

test('pawn capturing a pawn (including en passant) earns nothing', () => {
  assert.equal(evaluate('4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4', 'd5').earned, 0);
  assert.equal(evaluate('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5', 'd6').earned, 0);
});

test('pawn capture and threat stack', () => {
  // exd5 takes a knight (+1.5) and then attacks the rook on e6 (+0.5).
  const ev = evaluate('4k3/8/4r3/3n4/4P3/8/8/K7 w - - 0 1', 'e4', 'd5');
  assert.deepEqual(kinds(ev), ['capture', 'threat']);
  assert.equal(ev.earned, 2);
});

test('knight move costs 2', () => {
  const ev = evaluate(START_FEN, 'g1', 'f3');
  assert.deepEqual([ev.cost, ev.net], [2, -2]);
});

test('knight capture earns the full value of the captured piece', () => {
  const ev = evaluate('4k3/8/8/3r4/8/4N3/8/4K3 w - - 0 1', 'e3', 'd5');
  assert.deepEqual(kinds(ev), ['capture']);
  assert.equal(ev.earned, 5);
  assert.equal(evaluate('4k3/8/8/3p4/8/4N3/8/4K3 w - - 0 1', 'e3', 'd5').earned, 1);
});

test('knight check earns 3', () => {
  const ev = evaluate('4k3/8/8/8/4N3/8/8/4K3 w - - 0 1', 'e4', 'd6');
  assert.deepEqual(kinds(ev), ['check']);
  assert.equal(ev.net, 1);
});

test('bishop, rook and queen follow the same pattern', () => {
  const b = evaluate('4k3/8/8/8/8/8/2B5/4K3 w - - 0 1', 'c2', 'a4');
  assert.deepEqual([b.cost, b.earned], [2, 3]);
  const r = evaluate('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', 'a1', 'a8');
  assert.deepEqual([r.cost, r.earned], [4, 5]);
  const q = evaluate('4k3/8/8/8/8/8/3q4/3QK3 w - - 0 1', 'd1', 'd2');
  assert.deepEqual([q.cost, q.earned], [8, 9]);
});

test('capture and check stack', () => {
  // Rxe7+ takes a bishop (+3) and checks (+5).
  const ev = evaluate('4k3/4b3/8/8/8/8/8/4RK2 w - - 0 1', 'e1', 'e7');
  assert.deepEqual(kinds(ev), ['capture', 'check']);
  assert.equal(ev.earned, 8);
});

test('discovered check earns no bonus for the piece that moved', () => {
  // Bishop steps off the e-file revealing the rook's check; the bishop itself gives no check.
  const ev = evaluate('4k3/8/8/8/8/4B3/8/4RK2 w - - 0 1', 'e3', 'a7');
  assert.equal(ev.earned, 0);
});

test('king moves cost 1 and never earn, even when capturing', () => {
  const ev = evaluate('4k3/8/8/8/8/8/3q4/4K3 w - - 0 1', 'e1', 'd2');
  assert.deepEqual([ev.cost, ev.earned], [1, 0]);
  const castle = evaluate('4k3/8/8/8/8/8/8/4K2R w K - 0 1', 'e1', 'g1');
  assert.deepEqual([castle.cost, castle.earned], [1, 0]);
});

test('custom rules change the economy', () => {
  const rules = structuredClone(DEFAULT_RULES);
  rules.pieces.n.moveCost = 1;
  rules.pieces.n.checkBonus = 10;
  const ev = evaluate('4k3/8/8/8/4N3/8/8/4K3 w - - 0 1', 'e4', 'd6', rules);
  assert.equal(ev.net, 9);
});
