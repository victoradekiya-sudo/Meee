// Browser UI for Credit Chess: same-device, against the computer, or online.

import { colorOf, findKing, inCheck, squareName, typeOf, WHITE, BLACK } from './chess.js';
import { DEFAULT_RULES, PIECE_NAMES } from './credits.js';
import {
  accountSummary, availableMoves, COLOR_NAMES, createGame, playMove, propertyAt, replay, resign,
} from './game.js';
import { chooseMove, LEVELS } from './ai.js';
import { connectBackend, normalizeCode } from './online.js';

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT_STYLE = '︎'; // ask for the text glyph, not an emoji
const LAST_CODE_KEY = 'credit-chess:last-code';

const $ = (id) => document.getElementById(id);

const ui = {
  stack: [createGame()], // every game state so far, for take-backs
  // { kind: 'local' } | { kind: 'ai', human, level } |
  // { kind: 'online', session, code, color, players, unsubscribe }
  mode: { kind: 'local' },
  selected: null,        // square of the piece being moved
  hover: null,           // square under the pointer / keyboard focus
  pending: null,         // { kind: 'promotion' | 'buy', from, to, promotion? } while a dialog is open
  flipped: false,
  confirmResign: false,
  notice: null,          // one-off message shown in the price check
  setupOpen: false,
  thinking: false,       // the computer is choosing a move
  backend: undefined,    // online backend: undefined while checking, null if unavailable
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
const capital = (s) => s[0].toUpperCase() + s.slice(1);
const glyph = (p) => `<span class="piece ${colorOf(p)}" aria-hidden="true">${GLYPHS[typeOf(p)]}${TEXT_STYLE}</span>`;
const pieceName = (p) => `${COLOR_NAMES[colorOf(p)].toLowerCase()} ${PIECE_NAMES[typeOf(p)]}`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* not kept */ } },
};

// Who sits on each side, from this screen's point of view.
function seatName(color) {
  const m = ui.mode;
  if (m.kind === 'ai') return m.human === color ? 'You' : 'Computer';
  if (m.kind === 'online' && m.color) return m.color === color ? 'You' : 'Opponent';
  return COLOR_NAMES[color];
}

// Whether this screen may move the side to move right now, and if not, why.
function blockedReason() {
  const g = game();
  const m = ui.mode;
  if (g.result) return 'The game is over.';
  if (m.kind === 'ai' && (ui.thinking || g.state.turn !== m.human)) return 'The computer is thinking.';
  if (m.kind === 'online') {
    if (!m.color) return 'You are watching this game.';
    if (!m.players.b) return 'Waiting for your friend to join.';
    if (g.state.turn !== m.color) return `Waiting for ${COLOR_NAMES[g.state.turn]} to move.`;
  }
  return null;
}

// ---- moves ----------------------------------------------------------------

function commit(from, to, { promotion, buy = false } = {}) {
  const before = game();
  const next = playMove(before, { from, to, promotion, buy });
  ui.selected = ui.hover = ui.pending = ui.notice = null;
  ui.confirmResign = false;
  if (ui.mode.kind === 'online') {
    ui.stack = [next];
    pushOnline(before, next);
  } else {
    ui.stack.push(next);
  }
  render();
  maybeThink();
}

function onSquare(sq) {
  const g = game();
  if (ui.pending) return;
  ui.notice = null;
  ui.confirmResign = false;
  const blocked = blockedReason();
  if (blocked) {
    ui.selected = null;
    if (!g.result) ui.notice = blocked;
    return render();
  }

  if (ui.selected !== null) {
    const options = availableMoves(g).filter((m) => m.from === ui.selected && m.to === sq);
    if (options.length) {
      const move = options[0];
      if (!move.affordable) {
        ui.notice = `That ${PIECE_NAMES[typeOf(move.piece)]} move costs ${amount(move.cost)} credits. `
          + `${COLOR_NAMES[g.state.turn]} has ${amount(g.credits[g.state.turn])}.`;
      } else if (move.promotion) {
        ui.pending = { kind: 'promotion', from: move.from, to: move.to };
      } else if (move.canBuy) {
        ui.pending = { kind: 'buy', from: move.from, to: move.to };
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

// ---- computer player ------------------------------------------------------

let worker;           // undefined: not started, null: unavailable
let requestId = 0;
const requests = new Map();

function startWorker() {
  try {
    worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => requests.get(data.id)?.finish(data.move);
    worker.onerror = () => {
      // Fall back to thinking on the main thread.
      worker = null;
      for (const r of requests.values()) setTimeout(() => r.finish(chooseMove(r.game, r.level)), 0);
    };
  } catch {
    worker = null;
  }
}

function maybeThink() {
  const g = game();
  const m = ui.mode;
  if (m.kind !== 'ai' || g.result || g.state.turn === m.human || ui.thinking) return;
  ui.thinking = true;
  const id = ++requestId;
  const started = performance.now();
  const finish = (move) => {
    requests.delete(id);
    if (id !== requestId) return;
    // A short pause so the reply doesn't feel instantaneous.
    setTimeout(() => {
      if (id !== requestId) return;
      ui.thinking = false;
      if (move) commit(move.from, move.to, move);
      else render();
    }, Math.max(0, 450 - (performance.now() - started)));
  };
  requests.set(id, { finish, game: g, level: m.level });
  if (worker === undefined) startWorker();
  if (worker) worker.postMessage({ id, game: g, level: m.level });
  else setTimeout(() => finish(chooseMove(g, m.level)), 30);
  render();
}

function cancelThinking() {
  requestId++;
  ui.thinking = false;
}

// ---- online ---------------------------------------------------------------

function leaveOnline() {
  if (ui.mode.kind === 'online') ui.mode.unsubscribe?.();
}

function enterOnline(session) {
  leaveOnline();
  cancelThinking();
  ui.mode = { kind: 'online', session, code: session.code, color: session.color, players: { w: true, b: false }, unsubscribe: null };
  ui.stack = [createGame()];
  ui.flipped = session.color === BLACK;
  ui.selected = ui.pending = ui.notice = null;
  store.set(LAST_CODE_KEY, session.code);
  ui.mode.unsubscribe = session.subscribe(onRemote);
  render();
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function onRemote(update) {
  const m = ui.mode;
  if (m.kind !== 'online') return;
  if (update.error) { ui.notice = update.error; return render(); }
  m.players = update.players;
  const g = game();
  const house = { properties: Boolean(update.house.properties), bonuses: Boolean(update.house.bonuses) };
  const local = g.actions;
  const remote = update.actions;
  try {
    if (same(house, g.options) && same(remote, local.slice(0, remote.length)) && remote.length < local.length) {
      // Our own move hasn't come back from the server yet; keep showing it.
    } else if (same(house, g.options) && same(local, remote.slice(0, local.length))) {
      if (remote.length > local.length) ui.stack = [replay(house, remote.slice(local.length), g)];
    } else {
      ui.stack = [replay(house, remote)];
    }
  } catch {
    ui.notice = 'This game’s record contains a move that breaks the rules, so it can’t continue.';
  }
  if (game() !== g) ui.selected = ui.pending = null;
  render();
}

function pushOnline(before, next) {
  const m = ui.mode;
  m.session.push(next.actions).catch((err) => {
    if (ui.mode !== m) return;
    ui.stack = [before];
    ui.notice = `Your move wasn’t saved: ${err.message ?? 'connection problem'}`;
    render();
  });
}

// ---- actions --------------------------------------------------------------

function onAction(action) {
  const g = game();
  const m = ui.mode;
  if (action === 'undo') {
    cancelThinking();
    if (m.kind === 'ai') {
      do ui.stack.pop(); while (ui.stack.length > 1 && game().state.turn !== m.human);
    } else if (ui.stack.length > 1) {
      ui.stack.pop();
    }
    ui.selected = ui.pending = ui.notice = null;
    ui.confirmResign = false;
    render();
    return maybeThink();
  }
  if (action === 'flip') ui.flipped = !ui.flipped;
  if (action === 'new') { ui.setupOpen = true; ui.confirmResign = false; openSetup(); }
  if (action === 'resign') ui.confirmResign = true;
  if (action === 'cancel') ui.confirmResign = false;
  if (action === 'confirm-resign') {
    const loser = m.kind === 'ai' ? m.human : m.kind === 'online' ? m.color : g.state.turn;
    cancelThinking();
    const next = resign(g, loser);
    ui.confirmResign = false;
    ui.selected = ui.pending = null;
    if (m.kind === 'online') { ui.stack = [next]; pushOnline(g, next); } else ui.stack.push(next);
  }
  if (action === 'copy-code' && m.kind === 'online') {
    navigator.clipboard?.writeText(m.code).then(
      () => { ui.notice = `Copied ${m.code}. Send it to your friend.`; render(); },
      () => { ui.notice = `Copy the code ${m.code} and send it to your friend.`; render(); },
    );
  }
  render();
}

// ---- new-game panel -------------------------------------------------------

function setupError(text) {
  $('setup-error').hidden = !text;
  $('setup-error').textContent = text ?? '';
}

function syncSetup() {
  const opponent = document.querySelector('input[name="opponent"]:checked').value;
  $('ai-options').hidden = opponent !== 'ai';
  $('online-options').hidden = opponent !== 'online';
  const online = ui.backend;
  $('opp-online').disabled = online === null;
  $('online-note').textContent = online === undefined
    ? 'Checking whether online play is available…'
    : online === null
      ? 'Online play needs this page opened on claude.ai by people it’s shared with, or the game’s own server (npm start).'
      : 'Start a new game to get a code for your friend, or join with theirs. The game’s creator plays White.';
  $('join-fields').hidden = !online;
  $('setup-start').textContent = opponent === 'online' ? 'Create online game' : 'Start game';
  $('setup-start').disabled = opponent === 'online' && !online;
}

function openSetup() {
  const m = ui.mode;
  $(`opp-${m.kind}`).checked = true;
  $('house-properties').checked = game().options.properties;
  $('house-bonuses').checked = game().options.bonuses;
  if (!$('join-code').value) $('join-code').value = store.get(LAST_CODE_KEY) ?? '';
  setupError(null);
  syncSetup();
}

async function startFromSetup() {
  const opponent = document.querySelector('input[name="opponent"]:checked').value;
  const house = { properties: $('house-properties').checked, bonuses: $('house-bonuses').checked };
  setupError(null);
  if (opponent === 'online') {
    $('setup-start').disabled = true;
    try {
      enterOnline(await ui.backend.create(house));
      ui.setupOpen = false;
    } catch (err) {
      setupError(`Couldn’t create the game: ${err.message}`);
    }
    syncSetup();
    return render();
  }
  leaveOnline();
  cancelThinking();
  ui.stack = [createGame({ house })];
  ui.selected = ui.pending = ui.notice = null;
  if (opponent === 'ai') {
    let human = $('ai-color').value;
    if (human === 'random') human = Math.random() < 0.5 ? WHITE : BLACK;
    ui.mode = { kind: 'ai', human, level: $('ai-level').value };
    ui.flipped = human === BLACK;
  } else {
    ui.mode = { kind: 'local' };
  }
  ui.setupOpen = false;
  render();
  maybeThink();
}

async function joinFromSetup() {
  const code = normalizeCode($('join-code').value);
  if (code.length < 4) return setupError('Enter the code your friend sent you.');
  setupError(null);
  $('join-btn').disabled = true;
  try {
    const session = await ui.backend.join(code);
    ui.setupOpen = false;
    enterOnline(session);
    if (!session.color) ui.notice = 'Both seats are taken, so you’re watching this game.';
  } catch (err) {
    setupError(err.message);
  }
  $('join-btn').disabled = false;
  render();
}

// ---- rendering ------------------------------------------------------------

function renderActions() {
  const g = game();
  const m = ui.mode;
  let html;
  if (ui.confirmResign) {
    html = `<button class="btn warn" data-action="confirm-resign">Yes, resign</button>
            <button class="btn" data-action="cancel">Keep playing</button>`;
  } else {
    const canUndo = m.kind !== 'online' && ui.stack.length > 1 && !(m.kind === 'ai' && ui.stack.length < 3 && m.human === BLACK);
    const canResign = !g.result && !(m.kind === 'online' && !m.color);
    html = `${m.kind === 'online' ? '' : `<button class="btn" data-action="undo" ${canUndo ? '' : 'disabled'}>Take back</button>`}
            <button class="btn" data-action="flip" aria-pressed="${ui.flipped}">Flip board</button>
            <button class="btn" data-action="resign" ${canResign ? '' : 'disabled'}>Resign</button>
            <button class="btn" data-action="new" aria-expanded="${ui.setupOpen}">New game</button>`;
  }
  $('actions').innerHTML = html;
}

function renderModebar() {
  const g = game();
  const m = ui.mode;
  const rules = [g.options.properties && 'property and rent', g.options.bonuses && 'bonus squares'].filter(Boolean);
  const house = rules.length ? ` · House rules: ${rules.join(', ')}` : '';
  let html;
  if (m.kind === 'ai') {
    html = `<span><strong>You vs the computer</strong> (${LEVELS[m.level].label}) · you play ${COLOR_NAMES[m.human]}${house}</span>`;
    if (ui.thinking) html += '<span class="live">Computer is thinking</span>';
  } else if (m.kind === 'online') {
    html = `<span><strong>Online game</strong></span><span class="code" aria-label="Game code">${esc(m.code)}</span>
      <button class="btn small" data-action="copy-code">Copy code</button>
      <span>${m.color ? `You play ${COLOR_NAMES[m.color]}` : 'You are watching'}${house}</span>`;
    if (!m.players.b) html += '<span class="live">Waiting for your friend to join with this code</span>';
    else if (!g.result && m.color && g.state.turn !== m.color) html += '<span class="live">Opponent to move</span>';
  } else {
    html = `<span><strong>Two players, one screen</strong>${house}</span>`;
  }
  $('modebar').innerHTML = html;
}

function renderStatus() {
  const { result } = game();
  $('status').hidden = !result;
  if (result) $('status').textContent = result.text;
}

function renderAccount(el, color) {
  const g = game();
  const balance = g.credits[color];
  const { spent, earned } = accountSummary(g, color);
  const toMove = !g.result && g.state.turn === color;
  const checked = toMove && inCheck(g.state, color);
  const scale = Math.max(g.rules.startingCredits, g.credits[WHITE], g.credits[BLACK]);
  const owned = Object.entries(g.owners).filter(([, c]) => c === color).map(([sq]) => squareName(Number(sq)));
  let affordable = '';
  if (toMove) {
    const moves = availableMoves(g);
    affordable = `<span>Can afford <span class="num">${moves.filter((m) => m.affordable).length}</span> of ${moves.length} legal moves</span>`;
  }
  const name = seatName(color);
  el.dataset.color = color;
  el.classList.toggle('low', balance < 10);
  el.innerHTML = `
    <div class="acct-head">
      <span class="swatch" aria-hidden="true"></span>
      <span class="acct-name">${esc(name)}${name === COLOR_NAMES[color] ? '' : ` <small>(${COLOR_NAMES[color]})</small>`}</span>
      ${toMove ? '<span class="chip turn">To move</span>' : ''}
      ${checked ? '<span class="chip check">In check</span>' : ''}
    </div>
    <div class="bal"><span class="figure">${plain(balance)}</span><span class="unit">credits</span></div>
    <div class="meter" aria-hidden="true"><span style="width:${Math.max(0, (balance / scale) * 100)}%"></span></div>
    <div class="acct-stats">
      <span>Spent <span class="num">${amount(spent)}</span></span>
      <span>Earned <span class="num">${amount(earned)}</span></span>
      ${owned.length ? `<span>Owns <span class="num">${owned.join(' ')}</span></span>` : ''}
      ${affordable}
    </div>`;
}

function squareTag(g, sq) {
  const property = propertyAt(g, sq);
  if (property) {
    const owner = g.owners[sq];
    return owner
      ? `<span class="tag owner-${owner}" title="Owned by ${COLOR_NAMES[owner]}: rent ${property.rent}">${property.rent}</span>`
      : `<span class="tag ${property.group.toLowerCase()}" title="${property.group} property for sale: ${property.price}">${property.price}</span>`;
  }
  if (g.bonuses.includes(sq)) return `<span class="tag bonus" title="Bonus square">+${amount(g.rules.house.bonusAmount)}</span>`;
  return '';
}

function squareLabel(g, sq) {
  const property = propertyAt(g, sq);
  if (property) {
    const owner = g.owners[sq];
    return owner ? `, ${COLOR_NAMES[owner]}’s property, rent ${property.rent}` : `, property for sale at ${property.price}`;
  }
  return g.bonuses.includes(sq) ? `, bonus square worth ${amount(g.rules.house.bonusAmount)}` : '';
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
    let label = squareName(sq) + (p ? `, ${pieceName(p)}` : '') + squareLabel(g, sq);
    if (m) label += `, move here: ${signed(m.net)} credits${m.affordable ? '' : ', cannot afford'}`;
    html += `<button class="${cls.filter(Boolean).join(' ')}" data-sq="${sq}" aria-label="${label}">`
      + (p ? glyph(p) : '')
      + (m ? `<span class="price ${m.net > 0 ? 'up' : ''}">${signed(m.net)}</span>` : '')
      + squareTag(g, sq)
      + (col === 0 ? `<span class="coord rank">${r + 1}</span>` : '')
      + (row === 7 ? `<span class="coord file">${'abcdefgh'[f]}</span>` : '')
      + '</button>';
  }));
  $('board').innerHTML = html;
  renderDialog();
}

function renderDialog() {
  const g = game();
  const dialog = $('dialog');
  const pending = ui.pending;
  dialog.hidden = !pending;
  if (!pending) return;
  if (pending.kind === 'promotion') {
    const pawn = g.state.board[pending.from];
    dialog.innerHTML = `<div class="promo-card" role="dialog" aria-label="Choose promotion piece">
      <p>Promote to</p>
      <div class="promo-row">${['q', 'r', 'b', 'n'].map((t) => {
        const piece = colorOf(pawn) === WHITE ? t.toUpperCase() : t;
        return `<button data-promote="${t}" aria-label="${PIECE_NAMES[t]}">${glyph(piece)}</button>`;
      }).join('')}</div>
      <button class="btn" data-dialog="cancel">Cancel</button>
    </div>`;
    return;
  }
  const move = availableMoves(g).find((m) => m.from === pending.from && m.to === pending.to);
  const property = propertyAt(g, pending.to);
  const left = g.credits[g.state.turn] + move.net - move.buyPrice;
  dialog.innerHTML = `<div class="promo-card" role="dialog" aria-label="Buy property">
    <p>Buy ${squareName(pending.to)} for ${amount(move.buyPrice)} credits?</p>
    <p class="sub">${property.group} property. Enemy pieces that land here pay you ${amount(property.rent)}. You’d have ${plain(left)} credits left.</p>
    <div class="promo-actions">
      <button class="btn primary" data-dialog="buy">Buy and move</button>
      <button class="btn" data-dialog="move">Just move</button>
      <button class="btn" data-dialog="cancel">Cancel</button>
    </div>
  </div>`;
}

function bill(move, after) {
  const rows = [...move.charges.map((c) => [c.label, -c.amount]), ...move.gains.map((x) => [x.label, x.amount])];
  if (move.purchase) rows.push([`Bought ${squareName(move.to)}`, -move.purchase]);
  const net = rows.reduce((s, [, n]) => s + n, 0);
  return `<table class="bill"><tbody>
    ${rows.map(([label, n]) => `<tr><td>${esc(label)}</td><td class="${n < 0 ? 'neg' : 'pos'}">${signed(n)}</td></tr>`).join('')}
    <tr class="total"><td>Net</td><td class="${net < 0 ? 'neg' : net > 0 ? 'pos' : ''}">${signed(net)}</td></tr>
    <tr class="after"><td>Balance after</td><td>${plain(after)}</td></tr>
  </tbody></table>`;
}

function renderQuote() {
  const g = game();
  const el = $('quote');
  const balance = g.credits[g.state.turn];

  if (ui.notice) {
    el.innerHTML = `<p class="quote-title">Hold on</p><p>${esc(ui.notice)}</p>`;
    return;
  }
  if (ui.pending?.kind === 'promotion') {
    el.innerHTML = '<p class="quote-title">Promotion</p><p>Pick the piece your pawn becomes. The fee is the pawn’s, whatever you choose.</p>';
    return;
  }
  if (ui.selected !== null) {
    const p = g.state.board[ui.selected];
    const target = ui.pending?.to ?? ui.hover;
    const move = target !== null && availableMoves(g).find((m) => m.from === ui.selected && m.to === target);
    if (move) {
      let note = '';
      if (move.buyPrice !== null) {
        note = move.canBuy
          ? `<p class="note">For sale: you can buy ${squareName(move.to)} for ${amount(move.buyPrice)} when you land.</p>`
          : `<p class="note">For sale at ${amount(move.buyPrice)}, but you couldn’t afford it after this move.</p>`;
      }
      el.innerHTML = `<p class="quote-title">${capital(PIECE_NAMES[typeOf(p)])} to ${squareName(move.to)}${move.affordable ? '' : ' — can’t afford'}</p>`
        + bill(move, balance + move.net) + note;
      return;
    }
    const fee = g.rules.pieces[typeOf(p)].moveCost;
    el.innerHTML = `<p class="quote-title">${capital(pieceName(p))} on ${squareName(ui.selected)}</p>
      <p>Every ${PIECE_NAMES[typeOf(p)]} move costs <strong>${amount(fee)}</strong> credit${fee === 1 ? '' : 's'}.
      The number on each highlighted square is what that move nets you. Point at a square for the full bill.</p>`;
    return;
  }
  const last = g.history.at(-1);
  if (last) {
    el.innerHTML = `<p class="quote-title">Last move: ${esc(seatName(last.color))} ${esc(last.san)}</p>`
      + bill({ ...last, purchase: last.purchase }, last.balance);
    return;
  }
  el.innerHTML = `<p class="quote-title">${esc(seatName(g.state.turn))} to move</p>
    <p>Both players start with ${amount(g.rules.startingCredits)} credits. Select a piece to see what each of its moves costs and earns.</p>`;
}

function renderLedger() {
  const g = game();
  const rows = g.history.map((h, i) => `<tr>
      <td>${Math.floor(i / 2) + 1}${h.color === BLACK ? '…' : '.'}</td>
      <td><span class="dot ${h.color}" aria-hidden="true"></span>${esc(h.san)}${h.purchase ? '<span class="bought">bought</span>' : ''}</td>
      <td class="neg">${signed(-h.spent)}</td>
      <td class="${h.earned ? 'pos' : ''}">${h.earned ? signed(h.earned) : '–'}</td>
      <td>${plain(h.balance)}</td>
    </tr>`);
  $('ledger').innerHTML = rows.join('') || '<tr class="empty"><td colspan="5">No moves yet. White opens.</td></tr>';
  const scroller = $('ledger-scroll');
  scroller.scrollTop = scroller.scrollHeight;
}

function houseDescriptions(r) {
  return {
    properties: `${r.house.properties.map((p) => `${p.group} (${p.squares.join(' ')}) costs ${p.price}, rent ${p.rent}`).join('; ')}. `
      + 'The first player to land on one may buy it; enemy pieces that land there later pay the owner.',
    bonuses: `${r.house.bonusSquares.join(' ')} each pay ${amount(r.house.bonusAmount)} credits once, to the first piece that lands there.`,
  };
}

function renderRules() {
  const g = game();
  const r = g.rules;
  const rows = ['p', 'n', 'b', 'r', 'q', 'k'].map((t) => {
    const x = r.pieces[t];
    let capture = '–';
    let check = '–';
    if (t === 'p') { capture = '½ value*'; check = `+${amount(r.pawn.threatBonus)}*`; }
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
  const d = houseDescriptions(r);
  const state = (on) => `<small>${on ? 'on in this game' : 'off'}</small>`;
  $('house-rules').innerHTML = `
    <h3>Property and rent ${state(g.options.properties)}</h3><ul class="house-list"><li>${esc(d.properties)}</li>
      <li>Rent counts towards what a move costs, so it can bankrupt you.</li></ul>
    <h3>Bonus squares ${state(g.options.bonuses)}</h3><ul class="house-list"><li>${esc(d.bonuses)}</li></ul>`;
}

function render() {
  renderActions();
  renderModebar();
  $('setup').hidden = !ui.setupOpen;
  renderStatus();
  const [top, bottom] = ui.flipped ? [WHITE, BLACK] : [BLACK, WHITE];
  renderAccount($('acct-top'), top);
  renderAccount($('acct-bottom'), bottom);
  renderBoard();
  renderQuote();
  renderLedger();
  renderRules();
}

function markHover() {
  for (const b of $('board').children) {
    b.classList.toggle('hover', Number(b.dataset.sq) === ui.hover && b.classList.contains('target'));
  }
}

// ---- wiring ---------------------------------------------------------------

function start(saved = {}) {
  if (Array.isArray(saved.stack) && saved.stack.length) ui.stack = saved.stack;
  if (saved.mode && saved.mode.kind !== 'online') ui.mode = saved.mode;
  if (typeof saved.flipped === 'boolean') ui.flipped = saved.flipped;

  $('board').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sq]');
    if (b) onSquare(Number(b.dataset.sq));
  });
  const hover = (e) => {
    const b = e.target.closest('[data-sq]');
    const sq = b ? Number(b.dataset.sq) : null;
    if (sq !== ui.hover) { ui.hover = sq; if (ui.selected !== null && !ui.pending) { renderQuote(); markHover(); } }
  };
  $('board').addEventListener('pointerover', hover);
  $('board').addEventListener('focusin', hover);
  $('board').addEventListener('pointerleave', () => {
    ui.hover = null;
    if (ui.selected !== null && !ui.pending) { renderQuote(); markHover(); }
  });
  $('dialog').addEventListener('click', (e) => {
    const b = e.target.closest('[data-promote], [data-dialog]');
    if (!b) return;
    const { from, to } = ui.pending;
    if (b.dataset.promote) commit(from, to, { promotion: b.dataset.promote });
    else if (b.dataset.dialog === 'buy') commit(from, to, { buy: true });
    else if (b.dataset.dialog === 'move') commit(from, to);
    else { ui.pending = null; render(); }
  });
  const onActionClick = (e) => {
    const b = e.target.closest('[data-action]');
    if (b && !b.disabled) onAction(b.dataset.action);
  };
  $('actions').addEventListener('click', onActionClick);
  $('modebar').addEventListener('click', onActionClick);

  const d = houseDescriptions(DEFAULT_RULES);
  $('house-properties-desc').textContent = d.properties;
  $('house-bonuses-desc').textContent = d.bonuses;
  $('setup-form').addEventListener('change', syncSetup);
  $('setup-form').addEventListener('submit', (e) => { e.preventDefault(); startFromSetup(); });
  $('setup-cancel').addEventListener('click', () => { ui.setupOpen = false; render(); });
  $('join-btn').addEventListener('click', joinFromSetup);
  $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); joinFromSetup(); } });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ui.selected = ui.pending = ui.notice = null;
    ui.confirmResign = false;
    render();
  });

  render();
  maybeThink();

  connectBackend().then((backend) => {
    ui.backend = backend;
    syncSetup();
    if (backend && saved.online) backend.join(saved.online).then(enterOnline, () => {});
  }, () => { ui.backend = null; syncSetup(); });
}

window.claude?.hot?.snapshot?.(() => ({
  stack: ui.stack,
  mode: ui.mode.kind === 'online' ? { kind: 'local' } : ui.mode,
  online: ui.mode.kind === 'online' ? ui.mode.code : null,
  flipped: ui.flipped,
}));
if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
