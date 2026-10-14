import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  START_FEN, fromFEN, toFEN, legalMoves, makeMove, inCheck, toSAN, parseSquare, insufficientMaterial,
} from '../src/chess.js';

function perft(state, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of legalMoves(state)) n += perft(makeMove(state, m), depth - 1);
  return n;
}

// Reference node counts from https://www.chessprogramming.org/Perft_Results
const PERFT = [
  { name: 'start position', fen: START_FEN, counts: [20, 400, 8902] },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862] },
  { name: 'position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238] },
  { name: 'position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467] },
  { name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379] },
];

for (const { name, fen, counts } of PERFT) {
  test(`perft: ${name}`, () => {
    const state = fromFEN(fen);
    counts.forEach((expected, i) => assert.equal(perft(state, i + 1), expected, `depth ${i + 1}`));
  });
}

test('FEN round-trips', () => {
  for (const { fen } of PERFT) assert.equal(toFEN(fromFEN(fen)), fen);
});

test('SAN covers castling, disambiguation, promotion and mate', () => {
  const san = (fen, from, to, promotion) => {
    const s = fromFEN(fen);
    const m = legalMoves(s).find((x) => x.from === parseSquare(from) && x.to === parseSquare(to)
      && (x.promotion ?? null) === (promotion ?? null));
    return toSAN(s, m);
  };
  assert.equal(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'g1'), 'O-O');
  assert.equal(san('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', 'e1', 'c1'), 'O-O-O');
  assert.equal(san('4k3/8/8/8/8/7K/8/R6R w - - 0 1', 'a1', 'd1'), 'Rad1');
  assert.equal(san('4k3/8/8/8/8/8/P7/4K3 w - - 0 1', 'a2', 'a4'), 'a4');
  assert.equal(san('8/P6k/8/8/8/8/8/4K3 w - - 0 1', 'a7', 'a8', 'q'), 'a8=Q');
  assert.equal(san('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', 'a1', 'a8'), 'Ra8#');
});

test('check and insufficient material', () => {
  assert.equal(inCheck(fromFEN('4k3/8/8/8/8/8/8/4R1K1 b - - 0 1')), true);
  assert.equal(insufficientMaterial(fromFEN('4k3/8/8/8/8/8/8/4KB2 w - - 0 1')), true);
  assert.equal(insufficientMaterial(fromFEN('4k3/8/8/8/8/8/8/4KR2 w - - 0 1')), false);
});
