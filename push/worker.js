// Buses Vigo: alerts with the web closed.
// The page registers one alert per device: "tell me when line L is <= N min from stop S".
// Every minute a cron asks the Concello's API about the stops with alerts and sends a Web Push (no payload)
// when the bus is close; the service worker then fetches the text from POST /message.
// Bindings (wrangler.toml): DB (D1), VAPID_PUBLIC (var), VAPID_PRIVATE (secret, JWK), ALLOWED_ORIGIN (var), CONTACT (var).

const API = 'https://datos.vigo.org/vci_api_app/api2.jsp?ttl=5&tipo=TRANSPORTE-ESTIMACION-PARADA&id=';
const MAX_HOURS = 3;

export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    let body; try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const path = new URL(req.url).pathname;

    if (path === '/subscribe') {
      const { sub, stop, line, lead = 5, minutes = 90, lang = 'es', stopName = '' } = body;
      if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint)) return json({ error: 'bad subscription' }, 400);
      if (!Number.isInteger(stop) || stop <= 0 || typeof line !== 'string' || !/^[A-Z0-9]{1,12}$/i.test(line)) return json({ error: 'bad stop or line' }, 400);
      const until = Date.now() + Math.min(Math.max(+minutes || 90, 5), MAX_HOURS * 60) * 60000;
      await env.DB.prepare(`INSERT INTO alerts (id, endpoint, stop, line, lead, until, lang, stop_name, message)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)
        ON CONFLICT(id) DO UPDATE SET endpoint = ?2, stop = ?3, line = ?4, lead = ?5, until = ?6, lang = ?7, stop_name = ?8, message = NULL`)
        .bind(await hash(sub.endpoint), sub.endpoint, stop, line.toUpperCase(), Math.min(Math.max(+lead || 5, 1), 20), until, lang === 'gl' ? 'gl' : 'es', String(stopName).slice(0, 80)).run();
      return json({ ok: true, until });
    }
    if (path === '/unsubscribe') {
      if (typeof body.endpoint !== 'string') return json({ error: 'bad endpoint' }, 400);
      await env.DB.prepare('DELETE FROM alerts WHERE id = ?1').bind(await hash(body.endpoint)).run();
      return json({ ok: true });
    }
    if (path === '/message') {
      // the service worker asks what to show for the push it just got; the alert is done after that
      if (typeof body.endpoint !== 'string') return json({ error: 'bad endpoint' }, 400);
      const id = await hash(body.endpoint);
      const row = await env.DB.prepare('SELECT message FROM alerts WHERE id = ?1').bind(id).first();
      if (row && row.message) await env.DB.prepare('DELETE FROM alerts WHERE id = ?1').bind(id).run();
      return json(row && row.message ? JSON.parse(row.message) : { title: 'Buses Vigo', body: '' });
    }
    return json({ error: 'not found' }, 404);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(check(env));
  },
};

async function check(env) {
  const now = Date.now();
  await env.DB.prepare('DELETE FROM alerts WHERE until < ?1').bind(now).run();
  const { results } = await env.DB.prepare('SELECT * FROM alerts WHERE message IS NULL').all();
  if (!results.length) return;
  const byStop = new Map();
  for (const a of results) (byStop.get(a.stop) || byStop.set(a.stop, []).get(a.stop)).push(a);
  for (const [stop, alerts] of byStop) {
    let est;
    try {
      const res = await fetch(API + stop, { cf: { cacheTtl: 20 } });
      est = JSON.parse(new TextDecoder('iso-8859-1').decode(await res.arrayBuffer())).estimaciones || [];
    } catch { continue; }
    for (const a of alerts) {
      const e = est.filter(x => String(x.linea).trim().toUpperCase() === a.line && x.minutos >= 0 && x.minutos <= a.lead && x.metros >= 0).sort((p, q) => p.minutos - q.minutos)[0];
      if (!e) continue;
      const name = a.stop_name || `${a.lang === 'gl' ? 'a parada' : 'la parada'} ${a.stop}`;
      const msg = a.lang === 'gl'
        ? { title: 'Sae xa', body: e.minutos <= 0 ? `O teu ${a.line} está chegando a ${name}` : `O teu ${a.line} chega a ${name} en ${e.minutos} min` }
        : { title: 'Sal ya', body: e.minutos <= 0 ? `Tu ${a.line} está llegando a ${name}` : `Tu ${a.line} llega a ${name} en ${e.minutos} min` };
      await env.DB.prepare('UPDATE alerts SET message = ?2 WHERE id = ?1').bind(a.id, JSON.stringify({ ...msg, tag: 'bus-alert', url: `./?parada=${a.stop}` })).run();
      const status = await sendPush(a.endpoint, env);
      if (status === 404 || status === 410) await env.DB.prepare('DELETE FROM alerts WHERE id = ?1').bind(a.id).run();
    }
  }
}

// ---------- Web Push without payload: just a VAPID-signed POST to the push service ----------
async function sendPush(endpoint, env) {
  const aud = new URL(endpoint).origin;
  const jwt = await vapidJwt(aud, env);
  const res = await fetch(endpoint, { method: 'POST', headers: { TTL: '600', Urgency: 'high', Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'Content-Length': '0' } });
  return res.status;
}
let keyCache;
async function vapidJwt(aud, env) {
  keyCache = keyCache || await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.CONTACT })}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyCache, new TextEncoder().encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function hash(s) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))); }
