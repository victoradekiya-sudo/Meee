# Credit Chess

Standard chess with a Monopoly-style economy: every move costs credits,
captures and checks earn them back, and a player who can't pay for any legal
move is bankrupt and loses.

## Play

```sh
cd credit-chess
npm start        # http://localhost:8080
npm test         # rules engine, credit economy, house rules and computer player
```

No dependencies or build step; it's plain ES modules. Node 18+ for the server and tests.

**New game** offers three opponents:

- **Friend on this device**: take turns on one screen.
- **Computer**: Easy, Medium or Hard. It searches ahead and scores positions in
  credits, so it weighs cash, material and property against each other and
  avoids going bankrupt. It runs in a Web Worker, so the board stays responsive.
- **Friend online**: one player creates a game and sends the 6-character code;
  the other joins with it. The creator plays White, and anyone joining a full
  game watches. Each client replays and checks every move with the same rules
  engine. Under `npm start` the server also rejects illegal or out-of-turn
  moves. Games are kept in the server's memory, so they're lost when it stops.
  To play across the internet, run the server somewhere both players can reach.
  On claude.ai, the published page stores games in its shared database instead.
  Both players need Contributor (or higher) access to the page.

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

## House rules (optional, chosen per game)

- **Property and rent.** Prime squares (d4 e4 d5 e5) cost 6 and charge 3
  rent. Outpost squares (c3 f3 c6 f6) cost 4 and charge 2 rent. When your
  piece lands on an unowned one you may buy it. Any enemy piece that later
  ends a move there pays you rent. Rent counts towards what a move costs, so
  it can bankrupt you. Ownership is permanent.
- **Bonus squares.** b4 g4 b5 g5 each pay 3 credits once, to the first piece
  that lands there.

Squares, prices, rents and the bonus amount are in `DEFAULT_RULES.house`.

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
- `src/game.js` — game state: balances, property, ledger, results, replay
- `src/ai.js`, `src/ai-worker.js` — computer player (alpha-beta + capture search)
- `src/online.js` — online play over claude.ai's shared database or the local server
- `scripts/serve.js` — static server + online game API (server-sent events)
- `src/ui.js`, `index.html` — browser UI
