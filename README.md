# Buses Vigo

Mapa en tiempo real de los autobuses urbanos de Vigo (Vitrasa).

- Todas las líneas, con selector para ver solo las que te interesan.
- Al pulsar una parada, solo aparecen los buses que van a ella: dónde están, su recorrido hasta la parada y a qué hora llegan.
- Tu trayecto guardado (dónde subes y dónde bajas), con retraso respecto al horario y aviso cuando falten 5 minutos.
- Tema claro, oscuro o automático.
- En gallego.
- Enlaces directos a una parada (`?parada=6620`) para compartir o guardar.
- Avisos con la web cerrada, si se publica el servidor de avisos: ver [`push/README.md`](push/README.md).

## Datos

- **Tiempo real:** API abierta del Concello de Vigo (`datos.vigo.org`).
- **Líneas, recorridos, paradas y horarios:** [GTFS de Vitrasa](https://datos-ckan.vigo.org/dataset/gtfs-vitrasa), portal de datos abiertos del Concello de Vigo.
- **Mapa:** © [OpenStreetMap](https://www.openstreetmap.org/copyright), estilos de [OpenFreeMap](https://openfreemap.org).

La posición de cada bus se calcula a partir de la distancia que da la API hasta cada parada, proyectada sobre el recorrido oficial: no es el GPS del vehículo.

Proyecto personal, sin relación con Vitrasa ni con el Concello de Vigo.

## Pruebas

`tests/uso-real.js` usa la app como lo haría una persona con el móvil: primera visita, buscar y guardar paradas,
mirar el mapa, tocar un bus, arrastrar y ampliar con el dedo, abrir una parada, volver otro día, Vitrasa sin datos,
tema oscuro y ordenador. En cada pantalla revisa la accesibilidad (contraste WCAG AA, tamaño mínimo de letra, botones
de al menos 24 px, nombres para lectores de pantalla) y que no se tapen los buses ni los nombres de las paradas.

```
cd tests && npm install && npm test        # capturas en tests/out/
```
