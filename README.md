# Mi Estante

Registro de los libros que tienes y los que has leído. Cuando estás en una librería, escaneas el código de
barras del libro y te dice al momento si ya lo tienes y si lo has leído.

**Abrir la app:** https://adrityler370.github.io/book-collector/

Funciona en el navegador del móvil, sin cuenta y sin instalar nada de una tienda de apps.

## Qué hace

- **Escanear en la librería.** Apuntas la cámara al código de barras (el ISBN, que empieza por 978 o 979)
  y te sale *Ya lo tienes / No lo tienes* y *Leído / Sin leer*. Si tienes otra edición del mismo libro,
  también te avisa.
- **Escanear tu estantería.** Para empezar, vas pasando los libros que tienes en casa por la cámara y se
  añaden solos, uno detrás de otro.
- **Libros que no aparecen por su ISBN.** Escribes dos o tres palabras del título y eliges su portada; se
  rellenan título, autor y portada, y el libro conserva el ISBN que escaneaste.
- **Buscar por título o autor**, o escribir la ficha a mano para libros sin ISBN.
- **Ficha de cada libro:** lo tengo, lo he leído, lista de deseos, valoración, fecha y notas.
- **Sin conexión.** La comprobación por ISBN funciona sin cobertura. Los libros añadidos sin conexión
  completan su título y portada cuando vuelve la conexión.

## Instalarla en el móvil

- **iPhone (Safari):** botón Compartir → *Añadir a pantalla de inicio*.
- **Android (Chrome):** menú ⋮ → *Instalar app*, o desde la pestaña *Copia* de la propia app.

Instalada se abre a pantalla completa y el navegador no borra tus datos por falta de uso.

## Tus datos

Los libros se guardan **solo en tu móvil** (en el almacenamiento del navegador). No hay servidor ni cuenta:
nadie más los ve, y cada persona que use la app tiene su propio estante.

Por eso conviene hacer una copia de vez en cuando desde la pestaña **Copia**. El archivo `.json` se puede
enviar por WhatsApp, guardar en Drive o en Archivos, y cargarlo en otro móvil. Al cargar una copia se
añaden los libros que faltan y se actualizan los que cambiaron; no se borra nada.

Los datos de los libros (título, autor, portada) vienen de [Open Library](https://openlibrary.org) y de la
tienda de Apple Books, ambas gratis y sin claves ni cuentas. El código de barras se lee en el propio móvil.

En una prueba con 40 novedades y más vendidos de librerías españolas (octubre de 2026), Open Library
reconocía el ISBN de 16; con la búsqueda por título se encuentran 31. Los que faltan suelen ser álbumes
infantiles, libros en catalán o de editoriales pequeñas sin edición electrónica: esos se escriben a mano.

## Desarrollo

Web estática sin dependencias ni compilación: HTML, CSS y JavaScript.

```bash
npm start      # sirve la carpeta en http://localhost:8000 (python3 -m http.server)
npm test       # tests de la lógica (ISBN, coincidencias, copias) con node --test
```

La cámara solo funciona en `https://` o en `localhost`. Para probar desde el móvil, usa la versión
publicada en GitHub Pages.

| Fichero | Qué hace |
|---|---|
| `index.html`, `css/app.css` | Estructura y estilos |
| `js/app.js` | Pantallas y eventos |
| `js/lib.js` | Lógica pura: ISBN, coincidencias, lectura de las APIs, fusión de copias (con tests) |
| `js/store.js` | Guardado en IndexedDB |
| `js/lookup.js` | Open Library (por ISBN y por título) y Apple Books (por título) |
| `js/scanner.js` | Cámara y lectura de códigos (BarcodeDetector nativo o ZXing) |
| `sw.js`, `manifest.webmanifest`, `icons/` | App instalable y sin conexión |

**Publicar:** GitHub Pages sirve la rama `main` tal cual (Settings → Pages → *Deploy from a branch* →
`main` / `(root)`). Cada push a `main` se publica en un minuto o dos. Si añades un fichero nuevo que la
app necesita sin conexión, añádelo a la lista `SHELL` de `sw.js`. Los iconos se regeneran con
`python3 icons/make_icons.py`.

## Créditos

- Lectura de códigos de barras: [ZXing](https://github.com/zxing-js/library) (licencia Apache 2.0, ver
  `vendor/ZXING-LICENSE`).
- Datos de libros: [Open Library](https://openlibrary.org) (Internet Archive) y la búsqueda pública de
  Apple Books (iTunes Search API).
