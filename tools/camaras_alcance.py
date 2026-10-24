"""Where do the Concello's camera images answer from? Asks check-host.net to fetch one from servers in several
countries (Spain first), and also tries from here. Run in GitHub Actions (the "Cámaras" workflow)."""
import json, time, urllib.request, socket

URL = 'http://camaras.vigo.org/webcam/camv2.php?id=24'
def get(u, t=30):
    with urllib.request.urlopen(urllib.request.Request(u, headers={'Accept': 'application/json', 'User-Agent': 'buses-vigo'}), timeout=t) as r:
        return json.loads(r.read())

nodes = get('https://check-host.net/nodes/hosts')['nodes']
pick = [n for n, v in nodes.items() if v['location'][0].lower() in ('es', 'pt', 'fr', 'de', 'nl', 'it', 'gb')]
print('nodes:', {n: nodes[n]['location'][:3] for n in pick})
q = '&'.join('node=' + n for n in pick)
req = get(f'https://check-host.net/check-http?host={urllib.parse.quote(URL, safe="")}&{q}')
print('request', req.get('request_id'))
time.sleep(25)
res = get('https://check-host.net/check-result/' + req['request_id'])
for n, v in res.items():
    print(nodes.get(n, {}).get('location', ['?'])[:3], n, v)
for host in ('camaras.vigo.org', 'www.vigo.org', 'datos.vigo.org'):
    try:
        ip = socket.gethostbyname(host); s = socket.create_connection((ip, 80), timeout=10); s.close(); print(host, ip, 'tcp 80 open from GitHub')
    except Exception as e: print(host, 'from GitHub:', type(e).__name__, e)
