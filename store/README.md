# Publicación en las tiendas

Todo lo que se sube a la Chrome Web Store y a Microsoft Edge Add-ons (CV-509, D-204, D-223).
Firefox (addons.mozilla.org) no entra aquí.

> **Edge Add-ons, aparcado (24 nov. 2026, CV-552).** Microsoft bloqueó el alta en el Partner Center. Los usuarios de Edge instalan la extensión desde la Chrome Web Store («Permitir extensiones de otras tiendas»). De momento solo se sube el paquete de Chrome.

| Fichero | Qué es |
| --- | --- |
| `listing.es.md`, `listing.en.md` | Nombre, resumen y descripción de la ficha en los dos idiomas. |
| `privacy-practices.md` | Finalidad única, justificación de cada permiso, código remoto, declaración de uso de datos y notas para la revisión de Edge. |
| `images/promo-small-440x280.png` | Mosaico pequeño de la Chrome Web Store (obligatorio). |
| `images/promo-marquee-1400x560.png` | Marquesina de la Chrome Web Store (opcional). |
| `images/logo-300.png` | Logo de la ficha de Edge Add-ons (300 x 300). |
| `src/icons/icon-128.png` | Icono de la tienda: 96 x 96 de dibujo con 16 px transparentes alrededor. |
| `src/icons/icon-16.png`, `-32`, `-48` | Iconos de la barra: el isotipo sin margen (`scripts/make-icons.mjs`, CV-544). |
| `images/captura-<n>-<pantalla>-es.png`, `-en.png` | Las 5 capturas de la ficha (1280 x 800), una por idioma: guardar la oferta, encaje exprés, documentos, rellenar el formulario y marcar como enviada. Panel real con datos ficticios (CV-537). |

El vídeo de la ficha (CV-537) está en YouTube, oculto: [español](https://youtu.be/XmuD7_MDDLc) e [inglés](https://youtu.be/mK0r9bcaY4I). El enlace se pega en la ficha de cada idioma de la Chrome Web Store.

Los iconos y las imágenes salen del isotipo y del logotipo de la marca (`aplica-logo/png` del
repositorio de la web): el isotipo en color para los iconos, y el logotipo en negativo sobre el
fondo noche (`#15172B`) para las imágenes de promoción.

## Antes de subir

1. **Cuentas de desarrollador**, a nombre de la sociedad: Chrome Web Store (pago único de
   registro, con verificación de la cuenta como comerciante, *trader*, por vender servicios en
   la UE) y Microsoft Partner Center para Edge Add-ons (gratis).
2. **El repositorio de GitHub, público** (D-204: GPL-3.0, privado hasta publicar). La ficha
   enlaza el código.
3. **La política de privacidad publicada** en la web, con el apartado de la extensión (CV-509),
   antes de enviar a revisión: la tienda la comprueba.
4. **Una cuenta de prueba para la revisión** en producción, con datos ficticios: sin doble
   factor (el emparejamiento pide la contraseña, RS-05), con la flag `browser_extension`
   activa (D-159), un perfil profesional, una candidatura preparada y lecturas gratis del
   encaje exprés disponibles. El email y la contraseña van solo en el campo de instrucciones
   de cada tienda, nunca en este repositorio.
5. **La URL de vuelta de producción** en `EXTENSION_REDIRECT_URIS` de la web: con el ID que
   da cada tienda al subir el primer paquete, `https://<id>.chromiumapp.org/` en Chrome y su
   equivalente en Edge. Sin ella, el emparejamiento no funciona con la extensión de la tienda.

## Paquete

```sh
docker compose run --rm node npm ci
docker compose run --rm node npm run build
docker compose run --rm node npm run package
```

Se sube `dist/zip/aplica-extension-chrome-<versión>.zip` a la Chrome Web Store y
`dist/zip/aplica-extension-edge-<versión>.zip` a Edge Add-ons. La versión es la de
`package.json`; cada subida necesita una mayor que la anterior.

## Orden de publicación

1. **No listada**: visibilidad *Unlisted* en Chrome y *Hidden* en Edge. Solo la instala quien
   tiene el enlace: los beta-testers.
2. Cuando los beta-testers la den por buena, se pasa a **pública** en las dos tiendas. No hace
   falta subir otro paquete.

## Qué rellenar en cada tienda

**Chrome Web Store** (Developer Dashboard):

- *Store listing*: la descripción de `listing.<idioma>.md` en cada idioma (español como
  principal y añadir inglés), categoría *Productivity* (*Workflow & Planning*), icono, mosaico
  pequeño y marquesina, y la web `https://aplica.cv`.
- *Privacy practices*: todo `privacy-practices.md`, en el orden en que aparece.
- *Distribution*: visibilidad según el orden de publicación, en todos los países.
- *Test instructions*: la cuenta de prueba y los pasos de las notas de Edge.

**Edge Add-ons** (Partner Center):

- *Properties*: categoría *Productivity*, URL de la política de privacidad y web.
- *Store listings*: español e inglés, con la misma descripción, el logo de 300 x 300 y el
  mosaico pequeño.
- *Availability*: *Hidden* primero, luego *Public*.
- *Notes for certification*: el bloque del final de `privacy-practices.md`, con la cuenta de
  prueba y la URL del repositorio.
