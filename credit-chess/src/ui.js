// Browser UI for Credit Chess: two players sharing one screen.

import { colorOf, findKing, inCheck, squareName, typeOf, WHITE, BLACK } from './chess.js';
import { PIECE_NAMES } from './credits.js';
import { availableMoves, COLOR_NAMES, createGame, playMove, resign } from './game.js';

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT_STYLE = '︎'; // ask for the text glyph, not an emoji

const $ = (id) => document.getElementById(id);

const ui = {
  stack: [createGame()], // every game state so far, for take-backs
  selected: null,        // square of the piece being moved
  hover: null,           // square under the pointer / keyboard focus
  promotion: null,       // { from, to } while choosing a promotion piece
  flipped: false,
  confirm: null,         // 'new' | 'resign' while awaiting confirmation
  notice: null,          // one-off message shown in the price check
};
const game = () => ui.stack.at(-1);

// ---- formatting -----------------------------------------------------------

function amount(n) {
  const abs = Math.abs(n);
  return Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
}
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + amount(n);
const plain = (n) => (n < 0 ? '−' : '') + amount(n);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const glyph = (p) => `<span class="piece ${colorOf(p)}" aria-hidden="true">${GLYPHS[typeOf(p)]}${TEXT_STYLE}</span>`;
const capital = (s) => s[0].toUpperCase() + s.slice(1);
const pieceName = (p) => `${COLOR_NAMES[colorOf(p)].toLowerCase()} ${PIECE_NAMES[typeOf(p)]}`;

// ---- actions --------------------------------------------------------------

function commit(from, to, promotion) {
  ui.stack.push(playMove(game(), { from, to, promotion }));
  ui.selected = ui.hover = ui.promotion = ui.notice = null;
  ui.confirm = null;
  render();
}

function onSquare(sq) {
  const g = game();
  if (g.result || ui.promotion) return;
  ui.notice = null;
  ui.confirm = null;

  if (ui.selected !== null) {
    const options = availableMoves(g).filter((m) => m.from === ui.selected && m.to === sq);
    if (options.length) {
      const move = options[0];
      if (!move.affordable) {
        ui.notice = `That ${PIECE_NAMES[typeOf(move.piece)]} move costs ${amount(move.cost)} credits. `
          + `${COLOR_NAMES[g.state.turn]} has ${amount(g.credits[g.state.turn])}.`;
      } else if (move.promotion) {
        ui.promotion = { from: move.from, to: move.to };
      } else {
        return commit(move.from, move.to);
      }
      return render();
    }
  }

  const p = g.state.board[sq];
  ui.selected = p && colorOf(p) === g.state.turn && sq !== ui.selected ? sq : null;
  render();
}

function onAction(action) {
  const g = game();
  if (action === 'undo' && ui.stack.length > 1) {
    ui.stack.pop();
    ui.selected = ui.promotion = ui.notice = ui.confirm = null;
  } else if (action === 'flip') {
    ui.flipped = !ui.flipped;
  } else if (action === 'new' || action === 'resign') {
    ui.confirm = action;
  } else if (action === 'cancel') {
    ui.confirm = null;
  } else if (action === 'confirm-new') {
    ui.stack = [createGame()];
    ui.selected = ui.promotion = ui.notice = ui.confirm = null;
  } else if (action === 'confirm-resign') {
    ui.stack.push(resign(g, g.state.turn));
    ui.selected = ui.promotion = ui.confirm = null;
  }
  render();
}

// ---- rendering ------------------------------------------------------------

function renderActions() {
  const g = game();
  const mover = COLOR_NAMES[g.state.turn];
  let html;
  if (ui.confirm === 'new') {
    html = `<button class="btn warn" data-action="confirm-new">Yes, start over</button>
            <button class="btn" data-action="cancel">Keep playing</button>`;
  } else if (ui.confirm === 'resign') {
    html = `<button class="btn warn" data-action="confirm-resign">Yes, ${mover} resigns</button>
            <button class="btn" data-action="cancel">Keep playing</button>`;
  } else {
    html = `<button class="btn" data-action="undo" ${ui.stack.length > 1 ? '' : 'disabled'}>Take back</button>
            <button class="btn" data-action="flip" aria-pressed="${ui.flipped}">Flip board</button>
            <button class="btn" data-action="resign" ${g.result ? 'disabled' : ''}>Resign</button>
            <button class="btn" data-action="new">New game</button>`;
  }
  $('actions').innerHTML = html;
}

function renderStatus() {
  const { result } = game();
  $('status').hidden = !result;
  if (result) $('status').textContent = result.text;
}

function renderAccount(el, color) {
  const g = game();
  const balance = g.credits[color];
  const mine = g.history.filter((h) => h.color === color);
  const spent = mine.reduce((s, h) => s + h.cost, 0);
  const earned = mine.reduce((s, h) => s + h.net + h.cost, 0);
  const toMove = !g.result && g.state.turn === color;
  const checked = toMove && inCheck(g.state, color);
  const scale = Math.max(g.rules.startingCredits, g.credits[WHITE], g.credits[BLACK]);
  let affordable = '';
  if (toMove) {
    const moves = availableMoves(g);
    affordable = `<span>Can afford <span class="num">${moves.filter((m) => m.affordable).length}</span> of ${moves.length} legal moves</span>`;
  }
  el.dataset.color = color;
  el.classList.toggle('low', balance < 10);
  el.innerHTML = `
    <div class="acct-head">
      <span class="swatch" aria-hidden="true"></span>
      <span class="acct-name">${COLOR_NAMES[color]}</span>
      ${toMove ? '<span class="chip turn">To move</span>' : ''}
      ${checked ? '<span class="chip check">In check</span>' : ''}
    </div>
    <div class="bal"><span class="figure">${plain(balance)}</span><span class="unit">credits</span></div>
    <div class="meter" aria-hidden="true"><span style="width:${Math.max(0, (balance / scale) * 100)}%"></span></div>
    <div class="acct-stats">
      <span>Spent <span class="num">${amount(spent)}</span></span>
      <span>Earned <span class="num">${amount(earned)}</span></span>
      ${affordable}
    </div>`;
}

function renderBoard() {
  const g = game();
  const { board, turn } = g.state;
  const moves = ui.selected !== null ? availableMoves(g).filter((m) => m.from === ui.selected) : [];
  const targets = new Map(moves.map((m) => [m.to, m]));
  const last = g.history.at(-1);
  const checkSq = inCheck(g.state) ? findKing(board, turn) : -1;
  const ranks = ui.flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = ui.flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  let html = '';
  ranks.forEach((r, row) => files.forEach((f, col) => {
    const sq = r * 8 + f;
    const p = board[sq];
    const m = targets.get(sq);
    const cls = ['sq'];
    if ((r + f) % 2 === 0) cls.push('dark');
    if (last && (sq === last.from || sq === last.to)) cls.push('last');
    if (sq === ui.selected) cls.push('selected');
    if (sq === checkSq) cls.push('check');
    if (sq === ui.hover && m) cls.push('hover');
    if (m) cls.push('target', m.captured ? 'capture' : '', m.affordable ? '' : 'broke');
    let label = squareName(sq) + (p ? `, ${pieceName(p)}` : '');
    if (m) label += `, move here: ${signed(m.net)} credits${m.affordable ? '' : ', cannot afford'}`;
    html += `<button class="${cls.filter(Boolean).join(' ')}" data-sq="${sq}" aria-label="${label}">`
      + (p ? glyph(p) : '')
      + (m ? `<span class="price ${m.net > 0 ? 'up' : ''}">${signed(m.net)}</span>` : '')
      + (col === 0 ? `<span class="coord rank">${r + 1}</span>` : '')
      + (row === 7 ? `<span class="coord file">${'abcdefgh'[f]}</span>` : '')
      + '</button>';
  }));
  $('board').innerHTML = html;

  const promo = $('promo');
  promo.hidden = !ui.promotion;
  if (ui.promotion) {
    const pawn = board[ui.promotion.from];
    promo.innerHTML = `<div class="promo-card" role="dialog" aria-label="Choose promotion piece">
      <p>Promote to</p>
      <div class="promo-row">${['q', 'r', 'b', 'n'].map((t) => {
        const piece = colorOf(pawn) === WHITE ? t.toUpperCase() : t;
        return `<button data-promote="${t}" aria-label="${PIECE_NAMES[t]}">${glyph(piece)}</button>`;
      }).join('')}</div>
      <button class="btn" data-promote="">Cancel</button>
    </div>`;
  }
}

function bill(rows, net, after) {
  return `<table class="bill"><tbody>
    ${rows.map(([label, n]) => `<tr><td>${esc(label)}</td><td class="${n < 0 ? 'neg' : 'pos'}">${signed(n)}</td></tr>`).join('')}
    <tr class="total"><td>Net</td><td class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${signed(net)}</td></tr>
    <tr class="after"><td>Balance after</td><td>${plain(after)}</td></tr>
  </tbody></table>`;
}

function moveRows(piece, cost, gains) {
  return [[`${capital(PIECE_NAMES[typeOf(piece)])} move fee`, -cost],
    ...gains.map((x) => [x.label, x.amount])];
}

function renderQuote() {
  const g = game();
  const el = $('quote');
  const mover = COLOR_NAMES[g.state.turn];
  const balance = g.credits[g.state.turn];

  if (ui.notice) {
    el.innerHTML = `<p class="quote-title">Not enough credits</p><p>${esc(ui.notice)}</p>`;
    return;
  }
  if (ui.promotion) {
    el.innerHTML = '<p class="quote-title">Promotion</p><p>Pick the piece your pawn becomes. The fee is the pawn’s, whatever you choose.</p>';
    return;
  }
  if (ui.selected !== null) {
    const p = g.state.board[ui.selected];
    const move = ui.hover !== null && availableMoves(g).find((m) => m.from === ui.selected && m.to === ui.hover);
    if (move) {
      el.innerHTML = `<p class="quote-title">${capital(PIECE_NAMES[typeOf(p)])} to ${squareName(move.to)}${move.affordable ? '' : ' — can’t afford'}</p>`
        + bill(moveRows(p, move.cost, move.gains), move.net, balance + move.net);
      return;
    }
    const fee = g.rules.pieces[typeOf(p)].moveCost;
    el.innerHTML = `<p class="quote-title">${capital(pieceName(p))} on ${squareName(ui.selected)}</p>
      <p>Every ${PIECE_NAMES[typeOf(p)]} move costs <strong>${amount(fee)}</strong> credit${fee === 1 ? '' : 's'}.
      The number on each highlighted square is what that move nets you after earnings. Point at a square for the full bill.</p>`;
    return;
  }
  const last = g.history.at(-1);
  if (last) {
    el.innerHTML = `<p class="quote-title">Last move: ${COLOR_NAMES[last.color]} ${esc(last.san)}</p>`
      + bill(moveRows(last.piece, last.cost, last.gains), last.net, last.balance);
    return;
  }
  el.innerHTML = `<p class="quote-title">${mover} to move</p>
    <p>Both players start with ${amount(g.rules.startingCredits)} credits. Select a piece to see what each of its moves costs and earns.</p>`;
}

function renderLedger() {
  const g = game();
  const rows = g.history.map((h, i) => {
    const earned = h.net + h.cost;
    return `<tr>
      <td>${Math.floor(i / 2) + 1}${h.color === BLACK ? '…' : '.'}</td>
      <td><span class="dot ${h.color}" aria-hidden="true"></span>${esc(h.san)}</td>
      <td class="neg">${signed(-h.cost)}</td>
      <td class="${earned ? 'pos' : ''}">${earned ? signed(earned) : '–'}</td>
      <td>${plain(h.balance)}</td>
    </tr>`;
  });
  $('ledger').innerHTML = rows.join('') || '<tr class="empty"><td colspan="5">No moves yet. White opens.</td></tr>';
  const scroller = $('ledger-scroll');
  scroller.scrollTop = scroller.scrollHeight;
}

function renderRules() {
  const r = game().rules;
  const rows = ['p', 'n', 'b', 'r', 'q', 'k'].map((t) => {
    const x = r.pieces[t];
    let capture = '–';
    let check = '–';
    if (t === 'p') { capture = `½ value*`; check = `+${amount(r.pawn.threatBonus)}*`; }
    else if (t !== 'k') { capture = 'full value'; check = `+${amount(x.checkBonus)}`; }
    return `<tr><td>${capital(PIECE_NAMES[t])}</td>
      <td>${x.value ?? '–'}</td><td>${amount(x.moveCost)}</td><td>${capture}</td><td>${check}</td></tr>`;
  });
  $('rules').innerHTML = `<thead><tr><th>Piece</th><th>Value</th><th>Move fee</th><th>Capture earns</th><th>Check earns</th></tr></thead>
    <tbody>${rows.join('')}</tbody>`;
  $('rule-notes').innerHTML = [
    `Each player starts with ${amount(r.startingCredits)} credits. You pay the fee before the move; earnings land after it.`,
    `*Pawns earn only against higher-ranked pieces: half the value of a piece they capture, and ${amount(r.pawn.threatBonus)} when they land attacking one (the king counts).`,
    'Check bonuses go to the piece that moved and gave check. A discovered check earns nothing.',
    'If it’s your turn and you can’t afford any legal move, you are bankrupt and lose.',
    'Everything else is standard chess: checkmate wins; stalemate, repetition, the fifty-move rule and dead positions draw.',
  ].map((t) => `<li>${t}</li>`).join('');
}

function render() {
  renderActions();
  renderStatus();
  const [top, bottom] = ui.flipped ? [WHITE, BLACK] : [BLACK, WHITE];
  renderAccount($('acct-top'), top);
  renderAccount($('acct-bottom'), bottom);
  renderBoard();
  renderQuote();
  renderLedger();
}

// ---- wiring ---------------------------------------------------------------

function start(saved = {}) {
  if (Array.isArray(saved.stack) && saved.stack.length) ui.stack = saved.stack;
  if (typeof saved.flipped === 'boolean') ui.flipped = saved.flipped;

  $('board').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sq]');
    if (b) onSquare(Number(b.dataset.sq));
  });
  const hover = (e) => {
    const b = e.target.closest('[data-sq]');
    const sq = b ? Number(b.dataset.sq) : null;
    if (sq !== ui.hover) { ui.hover = sq; if (ui.selected !== null) { renderQuote(); markHover(); } }
  };
  $('board').addEventListener('pointerover', hover);
  $('board').addEventListener('focusin', hover);
  $('board').addEventListener('pointerleave', () => { ui.hover = null; if (ui.selected !== null) { renderQuote(); markHover(); } });
  $('promo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-promote]');
    if (!b) return;
    if (b.dataset.promote) commit(ui.promotion.from, ui.promotion.to, b.dataset.promote);
    else { ui.promotion = null; render(); }
  });
  $('actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (b && !b.disabled) onAction(b.dataset.action);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ui.selected = ui.promotion = ui.notice = ui.confirm = null; render(); }
  });

  renderRules();
  render();
}

function markHover() {
  for (const b of $('board').children) {
    b.classList.toggle('hover', Number(b.dataset.sq) === ui.hover && b.classList.contains('target'));
  }
}

window.claude?.hot?.snapshot?.(() => ({ stack: ui.stack, flipped: ui.flipped }));
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
