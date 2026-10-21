# Avisos con la web cerrada

Un servidor pequeño en Cloudflare Workers (gratis para este uso) vigila el bus por ti: cada minuto mira las alertas activas en la API del Concello y, cuando tu bus está a 5 minutos o menos, envía una notificación al móvil.

Mientras no esté publicado, la web avisa igual que antes, pero solo con la página abierta.

## Qué guarda

Una alerta por dispositivo: la dirección de notificaciones del navegador, la parada, la línea y hasta cuándo vale. Se borra en cuanto se envía el aviso, cuando quitas el aviso o, como mucho, a las 3 horas.

## Publicarlo (unos 10 minutos, una sola vez)

Necesitas [Node.js](https://nodejs.org) y una cuenta gratuita de [Cloudflare](https://dash.cloudflare.com/sign-up).

1. Desde la carpeta `push/` del repositorio:

   ```sh
   npx wrangler login
   npx wrangler d1 create buses-vigo-avisos
   ```

   Copia el `database_id` que imprime en `wrangler.toml`.

2. Crea la tabla:

   ```sh
   npx wrangler d1 execute buses-vigo-avisos --remote --file schema.sql
   ```

3. Genera las claves de las notificaciones:

   ```sh
   node gen-vapid.mjs
   ```

   - La clave **pública** va en `wrangler.toml` (`VAPID_PUBLIC`).
   - La clave **privada** es un secreto: guárdala en Cloudflare y en ningún otro sitio.

     ```sh
     npx wrangler secret put VAPID_PRIVATE
     ```

     Pega el JSON que imprimió el paso anterior.

4. En `wrangler.toml`, cambia `CONTACT` por tu correo (`mailto:tu@correo`). Comprueba también que `ALLOWED_ORIGIN` es la dirección de la web.

5. Publica:

   ```sh
   npx wrangler deploy
   ```

   Imprime la dirección del servidor, algo como `https://buses-vigo-avisos.TU-USUARIO.workers.dev`.

6. En `tools/push-config.js` pon esa dirección y la clave pública:

   ```js
   const PUSH = { url: 'https://buses-vigo-avisos.TU-USUARIO.workers.dev', key: 'LA-CLAVE-PÚBLICA' };
   ```

   Regenera la web con `node tools/assemble2.js network-gtfs.json index.html` (o espera a la actualización del lunes) y sube los cambios.

## En el móvil

- **Android (Chrome, Firefox, Edge):** funciona en el navegador. La primera vez pide permiso para notificaciones.
- **iPhone (iOS 16.4 o posterior):** solo con la web añadida a la pantalla de inicio (Compartir → «Añadir a pantalla de inicio») y abierta desde ese icono.

## Comprobar que va

- `npx wrangler tail` muestra en directo lo que hace el servidor.
- `npx wrangler d1 execute buses-vigo-avisos --remote --command "SELECT stop, line, datetime(until/1000,'unixepoch') FROM alerts"` lista las alertas activas.
