"""How right is the map? Watches the busiest stops of Vitrasa's real-time API for a while and measures, with no one
looking:

  - jump: how far a bus "teleports" on the map when new data comes in, compared with where the app had moved it
    (the app slides each bus at the speed the API implies until the next answer)
  - spread: one bus is seen from several stops at once; how far apart those positions are
  - ETA: when a bus reaches a stop (its minutes drop to 0 and it is gone), how wrong each earlier "N min" was
  - coverage: stops that answer, and estimates without a GPS position (metres -1)

    python3 tools/precision.py [minutes=12] [stops=30]

Prints a Markdown report (also to $GITHUB_STEP_SUMMARY in Actions) and keeps the history in precision/history.json.
"""
import json, math, os, statistics, sys, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

API = 'https://datos.vigo.org/vci_api_app/api2.jsp?ttl=5&tipo=TRANSPORTE-ESTIMACION-PARADA&id='
MINUTES = float(sys.argv[1]) if len(sys.argv) > 1 else 12
NSTOPS = int(sys.argv[2]) if len(sys.argv) > 2 else 30
EVERY = 30   # s between rounds
ALIAS = {'TUR': 'TURISTICO'}

net = json.load(open('data/net.json'))
routes = [r for r in net['routes'] if r.get('main')]
by_line = defaultdict(list)
for r in routes: by_line[r['line']].append({'id': r['id'], 'line': r['line'], 'stops': {s: d for s, d in r['stops']}})
# the stops more lines go through, where a check says the most
count = defaultdict(int)
for r in routes:
    for s, _ in r['stops']: count[s] += 1
STOPS = [s for s, _ in sorted(count.items(), key=lambda x: -x[1])[:NSTOPS]]


def fetch(stop):
    try:
        with urllib.request.urlopen(urllib.request.Request(API + str(stop), headers={'User-Agent': 'buses-vigo precision check'}), timeout=20) as r:
            est = json.loads(r.read().decode('iso-8859-1')).get('estimaciones') or []
        return stop, [{**e, 'linea': ALIAS.get(str(e['linea']).strip(), str(e['linea']).strip())} for e in est]
    except Exception:
        return stop, None


def route_for(line, stop):
    # the direction of the line that goes through this stop (the API doesn't say which; if both do, the first)
    for r in by_line.get(line, []):
        if stop in r['stops']: return r


rounds = []   # [(t, {stop: estimates or None})]
end = time.time() + MINUTES * 60
with ThreadPoolExecutor(4) as ex:
    while time.time() < end:
        t0 = time.time()
        rounds.append((t0, dict(ex.map(fetch, STOPS))))
        time.sleep(max(0, EVERY - (time.time() - t0)))

answered = sum(v is not None for _, rd in rounds for v in rd.values())
asked = len(rounds) * len(STOPS)
ests = [e for _, rd in rounds for v in rd.values() if v for e in v]
no_gps = sum(e.get('metros', -1) < 0 for e in ests)

# ---------- positions: each estimate with GPS is a bus at (route, metres along it) ----------
def positions(rd):
    out = []
    for stop, est in rd.items():
        for e in est or []:
            if e.get('metros', -1) < 0 or e['minutos'] > 30: continue
            r = route_for(e['linea'], stop)
            if not r: continue
            v = min(max(e['metros'] / (e['minutos'] * 60), 2), 12) if e['minutos'] > 0 else 4
            out.append({'route': r['id'], 'along': r['stops'][stop] - e['metros'], 'v': v, 'stop': stop, 'min': e['minutos']})
    return out

# spread: observations of one route within 400 m of each other, at the same moment, are the same bus
spreads = []
for _, rd in rounds:
    by_route = defaultdict(list)
    for p in positions(rd): by_route[p['route']].append(p['along'])
    for xs in by_route.values():
        xs.sort(); group = [xs[0]]
        for x in xs[1:] + [None]:
            if x is not None and x - group[-1] < 400: group.append(x); continue
            if len(group) > 1: spreads.append(group[-1] - group[0])
            if x is not None: group = [x]

# jump: where the app would have slid each bus by the next round, against where the new data puts it
jumps = []
for (t1, a), (t2, b) in zip(rounds, rounds[1:]):
    dt = t2 - t1
    nxt = defaultdict(list)
    for p in positions(b): nxt[(p['route'], p['stop'])].append(p['along'])
    for p in positions(a):
        guess = p['along'] + p['v'] * dt
        cand = [x for x in nxt.get((p['route'], p['stop']), []) if -100 < x - p['along'] < 800]
        if cand: jumps.append(min(abs(x - guess) for x in cand))

# ETA: for each (stop, line), follow the soonest bus; when its minutes go back up after reaching 0-1, it arrived
eta_err = defaultdict(list)   # horizon bucket -> minutes of error (positive: arrived later than said)
for stop in STOPS:
    for line in {e['linea'] for _, rd in rounds for e in (rd.get(stop) or [])}:
        hist = []
        for t, rd in rounds:
            m = [e['minutos'] for e in (rd.get(stop) or []) if e['linea'] == line]
            hist.append((t, min(m) if m else None))
        preds = []
        for i, (t, m) in enumerate(hist):
            if m is None: continue
            preds.append((t, m))
            nxt_m = next((x for _, x in hist[i + 1:i + 2]), None)
            if m <= 1 and (nxt_m is None or nxt_m > m + 2):
                arrived = t + 30   # between this round and the next
                for tp, mp in preds:
                    if tp < arrived - 30:
                        err = (arrived - tp) / 60 - mp
                        eta_err['0-5' if mp < 5 else '5-10' if mp < 10 else '10-20' if mp < 20 else '20+'].append(err)
                preds = []

def q(xs, p): return sorted(xs)[min(len(xs) - 1, int(p * len(xs)))] if xs else None
now = datetime.now(ZoneInfo("Europe/Madrid"))
run = {
    'when': now.isoformat(timespec='minutes'), 'minutes': MINUTES, 'stops': len(STOPS),
    'answered': round(100 * answered / asked) if asked else 0, 'no_gps': round(100 * no_gps / len(ests)) if ests else 0,
    'jump_med': round(statistics.median(jumps)) if jumps else None, 'jump_p90': q(jumps, 0.9) and round(q(jumps, 0.9)), 'jumps': len(jumps),
    'spread_med': round(statistics.median(spreads)) if spreads else None, 'spread_p90': q(spreads, 0.9) and round(q(spreads, 0.9)), 'spreads': len(spreads),
    'eta': {k: {'n': len(v), 'med': round(statistics.median(v), 1), 'p90abs': round(q([abs(x) for x in v], 0.9), 1)} for k, v in sorted(eta_err.items())},
}

# ---------- history and report ----------
os.makedirs('precision', exist_ok=True)
hp = 'precision/history.json'
hist = json.load(open(hp)) if os.path.exists(hp) else []
hist = [h for h in hist if h['when'] >= (now - timedelta(days=14)).isoformat()] + [run]
json.dump(hist, open(hp, 'w'), indent=1)

def fmt(x, u): return '–' if x is None else f'{x} {u}'
lines = [f"## Precisión do mapa · {run['when'][:16].replace('T', ' ')}",
         f"{len(rounds)} roldas de {len(STOPS)} paradas en {MINUTES:g} min. Responderon o {run['answered']} %; sen GPS: {run['no_gps']} % das estimacións.", '',
         '| Medida | Mediana | 90 % das veces, menos de |', '|---|---|---|',
         f"| Salto do bus no mapa ao chegar datos novos ({run['jumps']}) | {fmt(run['jump_med'], 'm')} | {fmt(run['jump_p90'], 'm')} |",
         f"| Diferenza entre paradas para o mesmo bus ({run['spreads']}) | {fmt(run['spread_med'], 'm')} | {fmt(run['spread_p90'], 'm')} |"]
for k, v in run['eta'].items():
    lines.append(f"| Erro do «chega en» a {k} min ({v['n']}) | {v['med']:+} min | {v['p90abs']} min |")
lines += ['', '### Últimas medicións', '| Cando | Responden | Salto (mediana) | Entre paradas | Erro 0-5 min |', '|---|---|---|---|---|']
for h in hist[-24:][::-1]:
    e = h['eta'].get('0-5', {})
    lines.append(f"| {h['when'][5:16].replace('T', ' ')} | {h['answered']} % | {fmt(h['jump_med'], 'm')} | {fmt(h['spread_med'], 'm')} | {('%+.1f min' % e['med']) if e else '–'} |")
md = '\n'.join(lines)
print(md)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    open(os.environ['GITHUB_STEP_SUMMARY'], 'a').write(md + '\n')
open('precision/README.md', 'w').write(md + '\n')
