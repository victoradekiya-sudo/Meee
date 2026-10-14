# Credit Chess

Standard chess with a Monopoly-style economy: every move costs credits,
captures and checks earn them back, and a player who can't pay for any legal
move is bankrupt and loses.

## Play

```sh
cd credit-chess
npm start        # http://localhost:8080 — two players, one screen
npm test         # rules engine + credit economy tests
```

No dependencies or build step; it's plain ES modules. Node 18+ for the server and tests.

## Rules

Each player starts with **100 credits**. You pay a move's fee before it is
played and receive its earnings after.

| Piece  | Value | Move fee | Capture earns            | Check earns |
|--------|------:|---------:|--------------------------|------------:|
| Pawn   | 1     | 1        | ½ value of a higher-ranked piece | — (see threat) |
| Knight | 3     | 2        | full value of captured piece | +3 |
| Bishop | 3     | 2        | full value                | +3 |
| Rook   | 5     | 4        | full value                | +5 |
| Queen  | 9     | 8        | full value                | +9 |
| King   | —     | 1        | nothing                   | — |

- **Pawn threat bonus:** a pawn that lands attacking a higher-ranked enemy
  piece (anything but a pawn, the king included) earns **+0.5**.
- Earnings stack: a knight that captures a rook and gives check earns 5 + 3.
- **Bankruptcy:** if it's your turn and every legal move costs more than your
  balance, you lose.
- Everything else is standard chess (castling, en passant, promotion,
  checkmate, stalemate, threefold repetition, fifty-move rule, dead positions).

## Decisions to confirm

The original brief fixed the pawn and knight rules and said "do likewise for
the other pieces except the king". These gaps were filled with defaults that
are easy to change in `src/credits.js` (`DEFAULT_RULES`):

1. **Bishop/rook/queen fees** follow the knight's pattern of *fee = value − 1*
   (2 / 4 / 8). Check bonus = the piece's value (3 / 5 / 9).
2. **King:** moves cost 1 and earn nothing (including castling and king
   captures). A free king would let a broke player stall forever.
3. **Pawn takes pawn** earns nothing (the brief only rewards higher-ranked captures).
4. **Pawn fork:** the threat bonus is +0.5 per move, not per threatened piece.
5. **Discovered check** earns nothing; the bonus belongs to the piece that moved
   and gave check.
6. **Running out:** you can't make a move you can't afford, and having no
   affordable move loses the game. Draws stay draws regardless of credits.

## Code

- `src/chess.js` — chess rules engine (verified against standard perft counts)
- `src/credits.js` — the price list and `evaluateMove()` (cost + earnings)
- `src/game.js` — game state: balances, ledger, bankruptcy and other results
- `src/ui.js`, `index.html` — browser UI
