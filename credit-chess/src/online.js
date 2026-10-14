// Online play. A shared game is just its house rules plus the list of
// actions played so far; each client replays and validates that list with
// the same engine, so neither side has to trust the other's arithmetic.
//
// Two interchangeable backends:
//   - claude: the page's shared database when it runs as a claude.ai artifact
//   - server: the bundled Node server (`npm start`)
// Each offers create(house) and join(code), resolving to a session:
//   { code, color: 'w' | 'b' | null (spectator), subscribe(fn) -> unsubscribe, push(actions) }
// subscribe() calls fn({ house, actions, players: { w, b } }) on every change.

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export const normalizeCode = (code) => String(code).toUpperCase().replace(/[^A-Z0-9]/g, '');

async function claudeBackend() {
  if (!window.claude?.use) return null;
  const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
  if (!db || !user) return null;
  const me = await user.id();
  if (!me || (await user.can('data.write')) === false) return null;
  const ref = (code) => db.doc(`games/${code}`);

  const session = (code, color) => ({
    code,
    color,
    subscribe(fn) {
      return ref(code).onSnapshot(
        (snap) => {
          if (!snap.exists) return;
          const d = snap.data();
          fn({ house: d.house ?? {}, actions: d.actions ?? [], players: { w: Boolean(d.white), b: Boolean(d.black) } });
        },
        () => fn({ error: 'Lost the connection to this game. Reload the page to reconnect.' }),
      );
    },
    push: (actions) => ref(code).update({ actions }),
  });

  return {
    kind: 'claude',
    async create(house) {
      const code = newCode();
      await ref(code).set({ white: me, black: null, house, actions: [], created: Date.now() });
      return session(code, 'w');
    },
    async join(rawCode) {
      const code = normalizeCode(rawCode);
      const r = ref(code);
      let d = (await r.get()).data();
      if (!d) throw new Error(`No game found with code ${code}.`);
      if (d.white === me) return session(code, 'w');
      if (d.black === me) return session(code, 'b');
      if (!d.black) {
        // Claim the empty seat under a short lease so two joiners can't both take it.
        const lease = await r.acquire({ holder: me, ttlMs: 5000 });
        if (lease.acquired) {
          d = (await r.get()).data();
          if (!d.black) {
            await r.update({ black: me });
            return session(code, 'b');
          }
        }
      }
      return session(code, null);
    },
  };
}

async function serverBackend() {
  try {
    const res = await fetch('api/health');
    if (!res.ok) return null;
  } catch {
    return null;
  }
  const tokenKey = (code) => `credit-chess:seat:${code}`;
  const loadToken = (code) => { try { return localStorage.getItem(tokenKey(code)); } catch { return null; } };
  const saveToken = (code, t) => { try { localStorage.setItem(tokenKey(code), t); } catch { /* per-tab only */ } };
  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}.`);
    return data;
  };

  const session = (code, color, token) => ({
    code,
    color,
    subscribe(fn) {
      const source = new EventSource(`api/games/${code}/events`);
      source.onmessage = (e) => fn(JSON.parse(e.data));
      return () => source.close();
    },
    push: (actions) => post(`api/games/${code}/actions`, { token, index: actions.length - 1, action: actions.at(-1) }),
  });

  return {
    kind: 'server',
    async create(house) {
      const { code, color, token } = await post('api/games', { house });
      saveToken(code, token);
      return session(code, color, token);
    },
    async join(rawCode) {
      const code = normalizeCode(rawCode);
      const { color, token } = await post(`api/games/${code}/join`, { token: loadToken(code) });
      if (token) saveToken(code, token);
      return session(code, color, token);
    },
  };
}

// The first backend this page can use, or null if online play is unavailable.
export async function connectBackend() {
  return (await claudeBackend()) ?? (await serverBackend());
}
