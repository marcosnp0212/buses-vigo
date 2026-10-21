// Generates the VAPID key pair for push alerts. Run once: node gen-vapid.mjs
// - the public key goes in wrangler.toml (VAPID_PUBLIC) and in tools/push-config.js (key)
// - the private key is a secret: npx wrangler secret put VAPID_PRIVATE  (paste the JSON). Never commit it.
const { webcrypto: c } = await import('node:crypto');
const kp = await c.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await c.subtle.exportKey('raw', kp.publicKey));
const b64url = (b) => Buffer.from(b).toString('base64url');
console.log('VAPID_PUBLIC (público):\n' + b64url(raw) + '\n');
console.log('VAPID_PRIVATE (secreto, no lo subas a GitHub):\n' + JSON.stringify(await c.subtle.exportKey('jwk', kp.privateKey)));
