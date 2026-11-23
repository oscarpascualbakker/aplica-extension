# Aplica browser extension

Free companion extension for [Aplica](https://aplica.cv). It lets you save job offers to your
Aplica account, see quickly how well they fit your profile, get the documents of a prepared
application and fill in application forms of seven ATS (without ever submitting them). This
version contains the side panel, the secure pairing with your Aplica account, saving the offer
you are looking at, a quick fit check against your profile, the prepared documents and the form
filling help.

Supported browsers: Chrome, Edge and Firefox, from a single Manifest V3 code base.

## What it does and what it does not do

- It reads a web page only when you press the Aplica icon on it, and only that tab. There are
  no content scripts and no host permission is granted on install, so it cannot read any page
  in the background. The one exception is "Marking an application as sent": while the panel is
  open, it checks whether a page of the seven ATS you allowed for form filling is the "thank you"
  page of an application.
- What it reads (job title, company, location, work mode, salary and description) is shown to
  you, editable, in the panel. Nothing is sent to Aplica until you press "Save to Aplica".
- It **never submits an application for you**: it never presses "Submit", never calls
  `submit()` or `requestSubmit()` on a form, never clicks a button and never fires Enter. The
  form filling help only writes values into fields (see "Filling in forms").
- It does not spend any credits. Saving an offer is free, and the quick fit in the panel only
  runs the free readings of the day; paid ones are confirmed on the Aplica website.
- It stores two things in `storage.local` of your browser: the connection token and the
  language of your account (`es` or `en`). No profile data is kept, not even the details
  copied or filled into a form.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Pressing the Aplica icon grants access to the current tab, only for that page and only until you navigate away. This is what allows reading the offer. |
| `scripting` | `scripting.executeScript` runs the packaged file `extract.js` in the active tab to read the offer, `fill.js` to fill in a form and `detect.js` to recognise the confirmation page of an ATS. Each returns a plain object to the panel and sends nothing anywhere. |
| `storage` | Keeps the connection token and the account language in `storage.local`. |
| `identity` | Opens the Aplica sign-in and approval page (`identity.launchWebAuthFlow`) to pair the browser. |
| `sidePanel` (Chrome and Edge) | Shows the Aplica panel when you click the icon. Firefox uses `sidebar_action`, which needs no permission. |
| Optional host access (`optional_host_permissions` in Chrome and Edge, `optional_permissions` in Firefox) | Only the form domains of the seven ATS the autofill supports (list below). Asked with `permissions.request` when you press "Fill in this form" in the panel, never on install. Without it only copying your details remains. |

There is no `externally_connectable`, no mandatory `host_permissions` and no content scripts.
Reading an offer never asks for host permission: if the page cannot be read (you moved to
another offer in the same tab, or opened the panel another way) it asks you to press the Aplica
icon on that page. API calls to Aplica work without host permission because the API answers
with `Access-Control-Allow-Origin: *` and the extension never sends cookies
(`credentials: 'omit'`).

Optional host access is limited to these patterns (the same list is in `scripts/manifest.mjs`
and `src/fill/ats.ts`, and a test checks they match). Outside them there is no autofill:

| ATS | Patterns |
| --- | --- |
| Workday | `*://*.myworkdayjobs.com/*`, `*://*.myworkdaysite.com/*` |
| Greenhouse | `*://boards.greenhouse.io/*`, `*://job-boards.greenhouse.io/*`, `*://job-boards.eu.greenhouse.io/*` |
| Lever | `*://jobs.lever.co/*`, `*://jobs.eu.lever.co/*` |
| SmartRecruiters | `*://jobs.smartrecruiters.com/*` |
| Workable | `*://apply.workable.com/*` |
| Teamtailor | `*://*.teamtailor.com/*` |
| Personio | `*://*.jobs.personio.de/*`, `*://*.jobs.personio.com/*` |

Why optional host access when `activeTab` exists: a form is often several pages (Workday) or a
page you reach after pressing the icon on the offer, and `activeTab` only lasts until you
navigate away. The permission is requested for the one ATS you are on, can be revoked from the
browser's extension settings at any time, and never covers other sites. Forms embedded in the
company's own website (for example a Greenhouse iframe) are not supported: only the top page of
those domains is filled.

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

## Filling in forms

The panel has a "Fill in a form" section (`src/panel/fill-section.ts`) with two phases.

**Phase A, on every site: copy and paste.** "Show my details" lists your Aplica profile (name,
email, phone, city, LinkedIn, GitHub, website, current role, years of experience, education)
with a copy button on each one (`navigator.clipboard.writeText`, from your click). The profile
comes from `GET /api/ext/v1/profile` (scope `profile.read`); `409 no_profile` explains that you
need a profile in Aplica and links to it; `403 insufficient_scope` and `401` are handled like
the other calls.

**Phase B, on Workday, Greenhouse, Lever, SmartRecruiters, Workable, Teamtailor and Personio:
autofill.** "Fill in this form" appears only on those domains. When you press it:

1. The panel asks for host access to that ATS (`permissions.request`, the very first thing it
   does inside your click). If you refuse, nothing is read or written and only phase A remains.
2. It reads your profile and, if the application of this offer is prepared (`ready`), its
   documents (`documents.questions`, CV-473). Without a prepared application it fills only the
   contact fields and says why the rest is missing. There is no application the extension
   could start: the token never launches anything and never spends credits.
3. It injects `fill.js` with `scripting.executeScript` into the active tab (still no content
   scripts) and calls it with the data as arguments. The script finds the fields, fills them and
   returns a summary the panel shows.

What the script does, in order, for every field:

- **Sensitive questions first.** A field whose label, question, name, id or options mention any
  of the topics below is left **empty** and marked "Answer this yourself" (red outline plus a
  visible label next to it, `data-aplica-ask-you`). This check runs before any other matching, so
  "Current salary" is never the current role and "Country of citizenship" is never the location.
  Visa, work permit, sponsorship, nationality and citizenship, salary and pay expectations,
  disability, gender and pronouns, origin, race and ethnicity, veteran status, sexual
  orientation, religion, age and date of birth, criminal record, relocation, availability, start
  date and notice period, in Spanish and English, ignoring case and accents. When in doubt it
  marks more rather than less.
- **Contact fields.** Detected from the associated `<label>`, `aria-label`, `aria-labelledby`,
  `placeholder`, `name`, `id` and `autocomplete`, plus a small adapter per ATS for what those do
  not resolve (Workday `data-automation-id`, Lever `name="org"` and `urls[...]`, Workable
  `data-ui`, Teamtailor `candidate[...]`, and so on). Name and surname fields are split by taking
  the first word as the name and the rest as the surname, always highlighted so you review them.
  A field that already has a value is never overwritten (yellow outline, "already had a value").
- **Open questions.** Filled with the answers of "Form questions" (`type: "redactar"` with an
  answer) when the question on the page is close enough to one of them (normalised text, accents
  and punctuation ignored, similarity of 0.6 or more). Anything else is left empty and counted.
  `contesta_tu` questions get the "Answer this yourself" mark.
- **The CV.** Fetched like the panel's download (`POST /offers/<id>/downloads`, then the one-use
  link with `credentials: 'omit'`): Word, or PDF if the file field only accepts PDF and the
  application has one. The file field is found by its adapter or by its label (`resume`, `CV`...),
  never the cover letter. The bytes cross from the panel to the injected script **as base64 in the
  `args` of `executeScript`**, because those arguments only take JSON in all three browsers. The
  script builds a `File` with the name from `Content-Disposition`, assigns it with `DataTransfer`
  and fires `input` and `change`.
- Selects, radio buttons, checkboxes and search-as-you-type dropdowns (`role="combobox"`) are
  never filled: choosing an option on your behalf is not unambiguous enough. Sensitive ones are
  still marked.
- Values are assigned with the native setter of the prototype (so React and Vue see them) and
  `input`, `change` and `blur` are fired. Everything filled gets a green outline and
  `data-aplica-filled`.

**It never submits.** `fill.js` does not call `submit()` or `requestSubmit()`, does not click any
button and does not fire Enter or any keyboard event. Tests spy on all of that while filling
every fixture, and a static check on the production bundle fails if those calls ever appear. The
panel reminds you to review what was filled and that sending it is up to you.

**What is not kept.** The profile, the answers and the CV only live in memory: in the panel while
the list is shown, and in the arguments of the one `executeScript` call. Nothing is written to
`storage.*` (a test checks it), and the data goes nowhere except into the form you are looking at.

The form fixtures (`tests/fixtures/forms/<ats>.html`) have invented content. Greenhouse, Lever,
Teamtailor and Personio follow the known public structure of their forms. **Workday, Workable and
SmartRecruiters are provisional**: built from the known stable attributes (`data-automation-id`,
`data-ui`, `name`), not from a captured page, until the owner captures the real one with "Export
page" (see "Capturing a page to build a fixture"). The Greenhouse and Lever adapters were checked
against public application forms in November 2026 (contact fields, CV input, links, pronouns and
demographic questions); Teamtailor, Personio and the three provisional ones have not been checked
against a live page yet, so their adapters may need adjusting when that happens.

## Marking an application as sent

When you finish an application form in one of the seven ATS and the company's site shows its
"thank you" page, the panel asks: "Have you sent the application? This page confirms that you have
sent your application for [job] at [company]", with "Mark it as sent" and "Not yet". **Nothing
changes until you press.** One click moves the application to the "sent" stage in your Aplica
tracker, with today's date if it had none, the extension as the source in its history and a
follow-up reminder 7 days later (shown in the panel). If the offer was not in your account, the
panel shows the job title and company it found, editable, and saves it straight away as sent.

**When it looks.** Only while the panel is open, and only on the domains of the seven ATS (the
same list as "Filling in forms"). When the active tab of the panel's window finishes loading one of
those pages, or when you press the Aplica icon, the panel runs `detect.js` in that tab. Without the
optional host access for that ATS the browser does not even tell the panel the tab's address, so
nothing is read there (except the page where you press the icon, through `activeTab`). There is
still no content script and nothing runs in the background service worker.

**How it recognises the page.** `src/sent/detect.ts` has one rule per ATS: the path of its
confirmation page (Greenhouse `/confirmation`, Lever `/thanks`, SmartRecruiters, Teamtailor), an
element only its "submitted" notice has (Workday, Workable and Personio keep the same address), or a
short heading that says the application was sent, in Spanish or English ("Gracias por tu
candidatura", "Application submitted"; never "thank you for your interest", which offers use). A
page that still has the form (an email or file field) is never the confirmation. The script only
reads the DOM: no network, no extension APIs, no clicks (a static check on the bundle fails
otherwise).

**Which application.** First the one the panel already knew for that tab on the same ATS site (the
offer it read, saved or found as a duplicate). Otherwise it asks Aplica (`offers/match`) with the
offer link worked out from the confirmation address, or the job title and company. If the
application is already sent or further along, there is no prompt: it never moves an application
backwards. The API calls are `POST /api/ext/v1/offers/{id}/sent` and, for a new one,
`POST /api/ext/v1/offers` with `sent: true`, both with the `offers.save` scope (no new scope, no
need to reconnect).

**What is not kept.** What the panel knows about each tab, and the prompts you dismissed, live in
its memory while it is open; nothing is written to `storage.*`.

The confirmation fixtures (`tests/fixtures/sent/<ats>.html`) have invented content and are
**provisional for all seven ATS**: they follow the known structure of those pages, not a captured
one. Capture the real "thank you" pages with "Export page" and adjust the rules in
`src/sent/detect.ts` when that happens.

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
`extract.js`), `src/fill/` (form filling: sensitive-question detector, field detection, ATS
adapters and domains; `inject.ts` is bundled apart as `fill.js`), `src/sent/` (confirmation page
detection; `inject.ts` is bundled apart as `detect.js`), `src/panel/` (side panel UI;
`fill-section.ts`, `fill-run.ts` and `fill-page.ts` are the form filling help, `sent-run.ts` the
"mark as sent" prompt), `src/_locales/` (`en` and `es`).

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
5. For an application form, the same applies to `tests/fixtures/forms/<ats>.html`, with a case in
   `tests/fill-fixtures.test.ts`. Replace the provisional fixtures (Workday, Workable and
   SmartRecruiters) this way and remove the "provisional" comment.

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
uploading to the browser stores is manual: see `store/README.md` (store listing, permission
justifications and data use declaration). Versioning follows semver.

## En español

La extensión de Aplica es gratuita y sirve para guardar ofertas en tu cuenta, ver rápido su
encaje con tu perfil, tener a mano los documentos de una candidatura preparada y ayudarte a
rellenar formularios de siete ATS. Esta versión incluye el panel lateral, el emparejamiento
seguro con tu cuenta, guardar la oferta que estás viendo, un encaje exprés con tu perfil, los
documentos preparados y la ayuda para rellenar formularios.

- Solo lee una página cuando pulsas el icono de Aplica en ella, y solo esa pestaña. No puede
  leer páginas en segundo plano. La excepción: con el panel abierto, en los siete ATS a los que
  diste acceso para rellenar, mira si la página es la de «gracias por tu candidatura».
- Al terminar el formulario de un ATS, si la página confirma el envío, el panel pregunta «¿Has
  enviado la candidatura?» y con un clic la marca como enviada en tu seguimiento de Aplica, con la
  fecha de hoy si no tenía y el recordatorio de seguimiento a los 7 días. Sin tu clic no cambia
  nada, y nunca retrasa una candidatura que ya va más allá. Si la oferta no estaba en tu cuenta,
  la guarda ya como enviada con el puesto y la empresa que revises.
- Lo que lee se te enseña, editable, en el panel. No se envía nada a Aplica hasta que pulsas
  «Guardar en Aplica».
- Nunca envía candidaturas por ti: no pulsa «Enviar», no llama a `submit()` ni a `requestSubmit()`,
  no hace clic en ningún botón y no pulsa Enter. Solo escribe valores en los campos.
- Rellenar formularios: en cualquier sitio, el panel lista los datos de tu perfil para copiarlos
  uno a uno. En Workday, Greenhouse, Lever, SmartRecruiters, Workable, Teamtailor y Personio,
  «Rellenar este formulario» rellena el contacto, adjunta el CV de la candidatura y responde las
  preguntas abiertas con las respuestas preparadas, resaltando en verde lo rellenado para que lo
  revises. Visado, permiso de trabajo, patrocinio, nacionalidad, salario, discapacidad, género,
  origen, veterano, orientación sexual, religión, edad, antecedentes, reubicación y
  disponibilidad no se rellenan nunca: quedan vacíos y marcados «Contéstalo tú». Los datos del
  perfil solo viven en memoria: no se guarda nada en el navegador.
- Si la oferta ya tiene la candidatura preparada en Aplica, el panel te da sus documentos a un
  clic: CV en Word y PDF, carta, mensaje al reclutador y cada respuesta del formulario para
  copiar. Los enlaces de descarga son de un solo uso y caducan a los 5 minutos.
- No gasta créditos: guardar una oferta es gratis, y el encaje exprés del panel solo hace las
  lecturas gratis del día. Las de pago se confirman en la web de Aplica.
- Guarda el token de conexión y el idioma de tu cuenta, en el almacenamiento local del navegador.

Permisos: `activeTab` (acceso a la pestaña actual solo al pulsar el icono), `scripting` (leer
la oferta de esa pestaña con un fichero propio de la extensión), `storage` (guardar el token y
el idioma), `identity` (abrir la página de aprobación de Aplica) y `sidePanel` (mostrar el
panel en Chrome y Edge). Sin permisos de sitios web al instalar: solo al pulsar «Rellenar este
formulario» el navegador te pide, de forma opcional, acceso al dominio del ATS en el que estás
(`optional_host_permissions`), y puedes retirarlo cuando quieras.

Emparejamiento: PKCE con `state`, aprobación en la web de Aplica y canje del código por un
token. Puedes desconectar desde el panel o desde la web. Para desarrollar, todo va en Docker
(comandos arriba) y la URL de vuelta de desarrollo en Chrome y Edge es la indicada en la
sección de desarrollo, en «Redirect URLs for the local web app».

## Licence

GPL-3.0. See [LICENSE](LICENSE).
