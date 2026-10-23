"""Can the Concello's public traffic cameras be used to check where the buses really are?

Run where datos.vigo.org is reachable (the "Cámaras" workflow does it in GitHub Actions):
    python3 tools/camaras.py            # needs Pillow; reads data/net.json

It lists the cameras, checks their image links, how often each image changes, how big it is, and which
Vitrasa lines and stops each camera can see (distance to the route shapes), then prints small thumbnails
of the most useful ones as base64 (IMG lines) so they can be looked at without downloading anything.
"""
import base64, hashlib, io, json, math, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

LIST = 'https://datos.vigo.org/data/trafico/camaras-trafico.json'
UA = {'User-Agent': 'buses-vigo camera survey (github.com/marcosnp0212/buses-vigo)'}


def get(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.status, dict(r.headers), r.read()


def decode(s):  # Google encoded polyline -> [(lat, lon)]
    out, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        vals = []
        for _ in range(2):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1
                res |= (b & 31) << shift; shift += 5
                if b < 32: break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]; lon += vals[1]
        out.append((lat / 1e5, lon / 1e5))
    return out


MX, MY = math.cos(math.radians(42.22)) * 111320, 110540
def dist_to_route(p, pts):
    x, y = p[1] * MX, p[0] * MY
    best = 1e9
    for (a1, o1), (a2, o2) in zip(pts, pts[1:]):
        x1, y1, x2, y2 = o1 * MX, a1 * MY, o2 * MX, a2 * MY
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy or 1
        f = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L2))
        best = min(best, math.hypot(x - x1 - f * dx, y - y1 - f * dy))
    return best


def main():
    st, hd, body = get(LIST)
    data = json.loads(body.decode('utf-8', 'replace'))
    cams = data if isinstance(data, list) else next((v for v in data.values() if isinstance(v, list)), [])
    print(f'cameras: {len(cams)}  (HTTP {st}, {len(body)} bytes)')
    print('fields:', sorted(cams[0].keys()) if cams else '-')
    for c in cams[:3]: print('example:', json.dumps(c, ensure_ascii=False))

    def field(c, *names):
        for n in names:
            for k in c:
                if k.lower() == n: return c[k]
    net = json.load(open('data/net.json'))
    routes = [(r['line'], decode(r['coords'])) for r in net['routes'] if r.get('main')]
    stops = net.get('stops', [])

    rows = []
    for c in cams:
        lat, lon = field(c, 'lat', 'latitud', 'latitude'), field(c, 'lon', 'lng', 'longitud', 'longitude')
        url = field(c, 'url', 'imagen', 'image')
        try: lat, lon = float(lat), float(lon)
        except Exception: lat = lon = None
        lines = sorted({l for l, pts in routes if lat is not None and dist_to_route((lat, lon), pts) <= 40})
        rows.append({'id': field(c, 'id', 'codigo'), 'name': field(c, 'nombre', 'name', 'descripcion'), 'lat': lat, 'lon': lon, 'url': url, 'lines': lines})

    def probe(r):
        if not r['url']: r['status'] = 'no url'; return r
        try:
            s1, h1, b1 = get(r['url'])
            r.update(status=s1, type=h1.get('Content-Type'), bytes=len(b1), last_modified=h1.get('Last-Modified'), cache=h1.get('Cache-Control'), h1=hashlib.sha1(b1).hexdigest()[:10], img=b1)
            try:
                from PIL import Image
                im = Image.open(io.BytesIO(b1)); r['size'] = f'{im.width}x{im.height}'
            except Exception as e: r['size'] = f'not an image ({type(e).__name__})'
        except Exception as e: r['status'] = f'error {type(e).__name__}: {e}'
        return r
    with ThreadPoolExecutor(12) as ex: rows = list(ex.map(probe, rows))

    # how often does the picture change? fetch again after 30 s and after 90 s
    def again(r):
        if 'h1' not in r: return r
        try: r['h2'] = hashlib.sha1(get(r['url'])[2]).hexdigest()[:10]
        except Exception: r['h2'] = 'error'
        return r
    time.sleep(30)
    with ThreadPoolExecutor(12) as ex: rows = list(ex.map(again, rows))
    time.sleep(60)
    def third(r):
        if 'h1' not in r: return r
        try: r['h3'] = hashlib.sha1(get(r['url'])[2]).hexdigest()[:10]
        except Exception: r['h3'] = 'error'
        return r
    with ThreadPoolExecutor(12) as ex: rows = list(ex.map(third, rows))

    ok = [r for r in rows if r.get('status') == 200 and 'x' in str(r.get('size'))]
    on_routes = [r for r in ok if r['lines']]
    print(f'\nimages working: {len(ok)}/{len(rows)}; on a bus route (<=40 m): {len(on_routes)}')
    print(f'changed after 30 s: {sum(r["h1"] != r.get("h2") for r in ok)}, after 90 s: {sum(r["h1"] != r.get("h3") for r in ok)}')
    from collections import Counter
    print('sizes:', Counter(r['size'] for r in ok).most_common(5))
    print('lines seen by some camera:', len({l for r in on_routes for l in r['lines']}), 'of', len({l for l, _ in routes}))
    print('\nid | name | lines within 40 m | size | 30s/90s changed | last-modified')
    for r in sorted(rows, key=lambda r: -len(r['lines'])):
        print(r['id'], '|', r['name'], '|', ','.join(r['lines']) or '-', '|', r.get('size', r.get('status')), '|',
              ('y' if r.get('h1') != r.get('h2') else 'n') + '/' + ('y' if r.get('h1') != r.get('h3') else 'n') if 'h1' in r else '', '|', r.get('last_modified'))

    from PIL import Image
    for r in sorted(on_routes, key=lambda r: -len(r['lines']))[:10]:
        im = Image.open(io.BytesIO(r['img'])).convert('RGB'); im.thumbnail((480, 360))
        b = io.BytesIO(); im.save(b, 'JPEG', quality=70)
        print('IMG', f"cam-{r['id']}.jpg", base64.b64encode(b.getvalue()).decode())


if __name__ == '__main__':
    main()
