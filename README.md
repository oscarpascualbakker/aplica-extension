# Aplica browser extension

Free companion extension for [Aplica](https://aplica.cv). It lets you save job offers to your
Aplica account, see quickly how well they fit your profile and, in future versions, fill in
application forms. This version contains the side panel, the secure pairing with your Aplica
account, saving the offer you are looking at and a quick fit check against your profile.

Supported browsers: Chrome, Edge and Firefox, from a single Manifest V3 code base.

## What it does and what it does not do

- It reads a web page only when you press the Aplica icon on it, and only that tab. There are
  no host permissions and no content scripts, so it cannot read any page in the background.
- What it reads (job title, company, location, work mode, salary and description) is shown to
  you, editable, in the panel. Nothing is sent to Aplica until you press "Save to Aplica".
- It never submits an application for you.
- It does not spend any credits. Saving an offer is free, and the quick fit in the panel only
  runs the free readings of the day; paid ones are confirmed on the Aplica website.
- It stores two things in `storage.local` of your browser: the connection token and the
  language of your account (`es` or `en`). No profile data is kept.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Pressing the Aplica icon grants access to the current tab, only for that page and only until you navigate away. This is what allows reading the offer. |
| `scripting` | `scripting.executeScript` runs the packaged file `extract.js` in the active tab to read the offer. It returns a plain object to the panel and sends nothing anywhere. |
| `storage` | Keeps the connection token and the account language in `storage.local`. |
| `identity` | Opens the Aplica sign-in and approval page (`identity.launchWebAuthFlow`) to pair the browser. |
| `sidePanel` (Chrome and Edge) | Shows the Aplica panel when you click the icon. Firefox uses `sidebar_action`, which needs no permission. |

There is no `externally_connectable`, no `host_permissions` and no content scripts. The panel
never asks for host permission: if the page cannot be read (you moved to another offer in the
same tab, or opened the panel another way) it asks you to press the Aplica icon on that page.
API calls to Aplica work
without host permission because the API answers with `Access-Control-Allow-Origin: *`
and the extension never sends cookies (`credentials: 'omit'`).

## How pairing works

1. The panel shows "Connect with Aplica" when there is no token.
2. On click, the extension creates a random `state` and a PKCE `code_verifier` (32 random
   bytes each, base64url), and the `code_challenge` (SHA-256, method `S256`, RFC 7636).
3. It opens `https://aplica.cv/app/extension/conectar?redirect_uri=…&state=…&code_challenge=…&code_challenge_method=S256&browser=chrome|edge|firefox`
   with `identity.launchWebAuthFlow`. You sign in and approve on the Aplica website.
4. Aplica redirects to the extension with `?code=…&state=…` (or `?error=…&state=…`). The
   extension aborts unless `state` matches exactly.
5. It exchanges the code with `POST /api/ext/v1/token` (`code`, `code_verifier`, `redirect_uri`)
   and keeps the returned bearer token in `storage.local`.
6. The panel calls `GET /api/ext/v1/me` and shows "Connected as <email>".
7. "Disconnect" calls `DELETE /api/ext/v1/token` and deletes the local token. If the API ever
   answers 401 (revoked on the website, expired), the local token is deleted and the panel
   goes back to "Connect" with a short notice. Network errors and 429 never delete the token.

The API must answer the extension's calls with CORS headers that allow the `Authorization`
and `Content-Type` headers and the `GET`, `POST` and `DELETE` methods (preflight).

## Saving an offer

When the panel opens (and each time you press the icon again) it reads the active tab:

1. **JSON-LD** `schema.org/JobPosting` (all `application/ld+json` blocks, `@graph`, arrays).
2. **Portal extractors** (by hostname) fill what the JSON-LD lacks. Portals with an own
   extractor: LinkedIn (guest page and signed-in layout, including the search view with an
   offer open), Infoempleo, Tecnoempleo, Greenhouse, Lever,
   SmartRecruiters, Teamtailor, Personio and Factorial. Their selectors come from real pages,
   and the fixtures in `tests/fixtures` keep that structure with invented content.
   InfoJobs, Indeed, Glassdoor, Workday and Workable are recognised (`portal` key) but rely on
   JSON-LD and on the selection until a real page is captured (see below).
3. **Selection**: if there is still no description, the text you selected on the page. If
   there is none, the panel asks you to select the offer text and press the button again.

The work mode (`presencial`, `hibrido`, `remoto`) is only taken from structured data or clear
portal labels, never guessed from free text. The description is cut at 30000 characters
(the panel says so) and the other fields at 255. The URL is the tab URL; on LinkedIn
`/jobs/search`, `/jobs/search-results` and `/jobs/collections` with `currentJobId` it becomes
`https://www.linkedin.com/jobs/view/<id>/`. The server stores a clean link (no tracking
parameters) and does the rest of the normalisation.

The panel calls `GET /api/ext/v1/offers/match` before saving and `POST /api/ext/v1/offers` to
save (candidate stage `guardada`, free). The panel language follows the `locale` returned by
`/me` (`es` or `en`), loaded from `_locales/<locale>/messages.json` by `src/i18n.ts`. Without
a connection, the browser language is used.

## Quick fit

Once the offer is saved (or if it already was), the panel offers "See fit": a quick reading of
the offer against your Aplica profile, with 3 to 5 key requirements (covered, to confirm or
missing) and a provisional verdict. It only runs when you press the button, never on saving.
The full fit report, made when you prepare the application in Aplica, is the one that counts,
and the panel says so.

- `GET /api/ext/v1/offers/<id>/quick-fit` (scope `tracker.read`) returns the last reading, the
  free readings left today and the price; `404` means the feature is off, and the block is hidden.
- `POST /api/ext/v1/offers/<id>/quick-fit` (scope `profile.read`) runs a new one. The extension
  only runs the free readings of the day: the token never spends credits. When they are used up
  (`402 credits_required`), the panel opens the application in Aplica, where you confirm the price.
- Failures (`unavailable`, `failed`, `running`) do not use up a reading, and the button can be
  pressed again. `report_exists` points to the full report; `no_posting` and `no_profile` explain
  what is missing.
- "Prepare full application" opens the application in Aplica with the prepare panel in view.

## Prepared documents

When the offer already has a prepared application in Aplica (`ready: true`), the panel shows
its documents instead of the quick fit: download the CV in Word and, if it exists, in PDF; copy
the letter; copy the direct message to the recruiter; and copy each answer of "Form questions"
on its own. Questions of type `contesta_tu` have no answer: the panel shows the question and its
note, without a copy button. If the application exists but is not prepared (`ready: false`), the
panel stays as before (quick fit and the link to prepare it on the web). The token never starts
an application and never spends credits.

- `GET /api/ext/v1/offers/<id>/documents` (scope `documents.read`) returns the texts and which CV
  formats exist. `409 not_ready` if it is not prepared; `403 insufficient_scope` for a token
  issued before the scope existed (the panel also checks `scopes` from `/me`).
- `POST /api/ext/v1/offers/<id>/downloads` with `{"format":"docx"|"pdf"}` returns a one-use link
  valid for 5 minutes. The panel fetches it with no `Authorization` header (the secret is in the
  URL, and only a URL on the same origin as the API is requested), builds a `Blob` and saves it
  with `<a download>`, named after `Content-Disposition`. A `410` asks for one new link, once.
- Copying uses `navigator.clipboard.writeText` from the click. No `downloads` or
  `clipboardWrite` permission is added.
- With a token without `documents.read`, the panel explains that this browser has to be
  connected again, and offers to do it. It never deletes the token on its own.
- When the match is by company and role (not by link) and that application is prepared, the
  documents open inside the preview, so what you were editing is kept.

The "✕" button at the top right closes the panel in every state (`src/panel/close.ts`):
`sidePanel.close()` for the current window in Chrome and Edge, `sidebarAction.close()` in
Firefox, and `window.close()` as a fallback. In Chrome and Edge the icon only opens the panel
(and reads the page again if it is already open); in Firefox it toggles the sidebar.

## Development (Docker only)

There is no Node on the host. Everything runs in the `node` service of `docker-compose.yml`
(Node 22.23.5):

```sh
docker compose run --rm node npm ci          # install dependencies
docker compose run --rm node npm run lint
docker compose run --rm node npm run typecheck
docker compose run --rm node npm test
docker compose run --rm node npm run build       # production, API_BASE=https://aplica.cv
docker compose run --rm node npm run build:dev   # development, API_BASE=http://localhost:8000, with "Export page"
docker compose run --rm node npm run package     # zips in dist/zip (after a build)
```

The build writes `dist/chrome`, `dist/edge` and `dist/firefox`. The manifest of each target
is generated by `scripts/manifest.mjs` from a common base plus per-browser differences.

Source layout: `src/api.ts` (API client), `src/session.ts` (pairing and session),
`src/pkce.ts`, `src/token-store.ts`, `src/locale-store.ts`, `src/i18n.ts` (account language),
`src/browser.ts` (browser adapter), `src/background.ts` (icon click), `src/extract/` (offer
extraction: JSON-LD, portal extractors, text conversion; `inject.ts` is bundled apart as
`extract.js`), `src/panel/` (side panel UI), `src/_locales/` (`en` and `es`).

### Capturing a page to build a fixture

The development build (`npm run build:dev`, never the production one) adds an "Export page"
button at the bottom of the panel. It saves `document.documentElement.outerHTML` and the tab
URL to an `.html` file (Blob and `<a download>`, no `downloads` permission). The code is
removed from the production bundle by a build constant, and a test checks it.

1. Load the development build, open the offer, press the Aplica icon and then "Export page".
2. Keep the downloaded file in `fixtures-raw/` (ignored by Git). **It contains personal data
   and real content: never commit it or share it outside the project.**
3. Turn it into `tests/fixtures/<portal>.html`: keep the structure the extractor uses (tags,
   classes, attributes, JSON-LD), replace every piece of real content with an invented offer
   ("Desarrolladora backend", "Empresa Ficticia S.L."), and drop third-party scripts and styles.
   A test rejects fixtures that mention the real companies of the pages used so far.
4. Add the portal to `src/extract/portals.ts` and a case to `tests/extract-fixtures.test.ts`.

Portals that could not be downloaded without an account or a browser (InfoJobs and Indeed and
Glassdoor behind a captcha or security check, Workday and Workable rendered by script) are
waiting for a capture made this way. The LinkedIn signed-in extractor comes from a capture of
`/jobs/view/<id>`; the search view (`/jobs/search-results`) shares its anchors but has not been
captured yet.

### Load the unpacked extension

Run `npm run build:dev` first.

- **Chrome and Edge**: open `chrome://extensions` or `edge://extensions`, enable developer
  mode, choose "Load unpacked" and select `dist/chrome` or `dist/edge`. The development
  manifest carries a public `key`, so the extension ID is always
  `mjogifiajemhnhjdjoeakmoemijeidba`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, choose "Load Temporary
  Add-on" and select `dist/firefox/manifest.json`. It is removed when Firefox restarts.

### Redirect URLs for the local web app

The web app only redirects to the URLs listed in its `EXTENSION_REDIRECT_URIS` setting.

- Chrome and Edge (development ID): `https://mjogifiajemhnhjdjoeakmoemijeidba.chromiumapp.org/`
- Firefox: the URL comes from `identity.getRedirectURL()` and depends on the `gecko.id`
  (`extension@aplica.cv`). To get it, load the temporary add-on, click "Inspect" next to it in
  `about:debugging` and run `browser.identity.getRedirectURL()` in the console. It looks like
  `https://<hash>.extensions.allizom.org/`.

The private key behind the development `key` is not stored in this repository.

## Releases

Pushing a tag `v*` makes the CI create a GitHub release with the three zips. Signing and
uploading to the browser stores is not automated yet. Versioning follows semver.

## En español

La extensión de Aplica es gratuita y sirve para guardar ofertas en tu cuenta, ver rápido su
encaje con tu perfil y, en próximas versiones, rellenar formularios. Esta versión incluye el panel lateral, el emparejamiento
seguro con tu cuenta, guardar la oferta que estás viendo y un encaje exprés con tu perfil.

- Solo lee una página cuando pulsas el icono de Aplica en ella, y solo esa pestaña. No puede
  leer páginas en segundo plano.
- Lo que lee se te enseña, editable, en el panel. No se envía nada a Aplica hasta que pulsas
  «Guardar en Aplica».
- Nunca envía candidaturas por ti.
- Si la oferta ya tiene la candidatura preparada en Aplica, el panel te da sus documentos a un
  clic: CV en Word y PDF, carta, mensaje al reclutador y cada respuesta del formulario para
  copiar. Los enlaces de descarga son de un solo uso y caducan a los 5 minutos.
- No gasta créditos: guardar una oferta es gratis, y el encaje exprés del panel solo hace las
  lecturas gratis del día. Las de pago se confirman en la web de Aplica.
- Guarda el token de conexión y el idioma de tu cuenta, en el almacenamiento local del navegador.

Permisos: `activeTab` (acceso a la pestaña actual solo al pulsar el icono), `scripting` (leer
la oferta de esa pestaña con un fichero propio de la extensión), `storage` (guardar el token y
el idioma), `identity` (abrir la página de aprobación de Aplica) y `sidePanel` (mostrar el
panel en Chrome y Edge). Sin permisos de sitios web.

Emparejamiento: PKCE con `state`, aprobación en la web de Aplica y canje del código por un
token. Puedes desconectar desde el panel o desde la web. Para desarrollar, todo va en Docker
(comandos arriba) y la URL de vuelta de desarrollo en Chrome y Edge es la indicada en la
sección de desarrollo, en «Redirect URLs for the local web app».

## Licence

GPL-3.0. See [LICENSE](LICENSE).
