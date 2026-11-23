# Privacy practices and permission justifications

Texts for the "Privacy practices" tab of the Chrome Web Store and for the certification notes of
Microsoft Edge Add-ons (CV-509). They must say the same as the "Browser extension" section of the
Aplica privacy policy (https://aplica.cv/en/legal/privacy) and as the README. If the manifest
changes (`scripts/manifest.mjs`), update this file in the same pull request.

The stores do not render Markdown: paste the text inside each block as it is.

## Single purpose

```text
Aplica is a companion to the Aplica job application service (aplica.cv). It lets the user save the job posting they are looking at to their Aplica account, see a quick fit check against their career profile, use the documents of an application already prepared in Aplica, fill in application forms on seven applicant tracking systems without ever submitting them, and mark an application as sent in their Aplica tracker. Everything it does serves that one purpose: managing the user's own job applications in Aplica.
```

## Permission justifications

### activeTab

```text
When the user clicks the Aplica icon, activeTab grants temporary access to that tab only, so the extension can read the job posting on the page (title, company, location, work mode, salary, description and link) and show it in the side panel for the user to review and save. It has no access to any page the user has not clicked the icon on.
```

### scripting

```text
Used only with scripting.executeScript to run files packaged in the extension (extract.js, fill.js, detect.js) in the active tab: to read the job posting after the user clicks the icon, to fill in an application form when the user presses "Fill in this form", and to recognise the confirmation page after the user finishes a form. No remote code is ever loaded or executed, and there are no content scripts.
```

### storage

```text
Stores two values in storage.local: the access token that connects this browser to the user's Aplica account, and the language of the account (es or en) for the panel. No profile data, browsing data or form data is stored.
```

### identity

```text
Used only for identity.launchWebAuthFlow, to open the Aplica sign-in and approval page and receive a one-time code (OAuth 2.0 for native apps with PKCE, RFC 8252 and RFC 7636) that the extension exchanges for its access token. It does not read the browser's Google account or any other identity.
```

### sidePanel

```text
Shows the Aplica panel next to the page when the user clicks the extension icon. All the features (save the posting, quick fit, documents, form filling, mark as sent) live in that panel.
```

### Optional host permissions

```text
Optional, never requested at install. When the user presses "Fill in this form" on one of seven applicant tracking systems (Workday, Greenhouse, Lever, SmartRecruiters, Workable, Teamtailor, Personio), the extension asks with permissions.request for access to that system's application form domains only (for example *://jobs.lever.co/*). It is needed because an application form often spans several pages, and activeTab ends when the user navigates. With it, the extension fills in the form fields the user asks for (never submitting the form, never clicking any button) and recognises that system's confirmation page to offer marking the application as sent. The user can revoke it at any time from the browser's extension settings. Without it, the user can still copy their details from the panel.
```

### Host permissions (mandatory)

None. The extension calls the Aplica API (https://aplica.cv/api/ext/v1/...) without host
permissions because the API answers with CORS and the extension never sends cookies.

## Remote code

```text
No, I am not using remote code. All JavaScript is packaged in the extension. The extension only exchanges JSON data with the Aplica API.
```

## Data usage (Chrome Web Store checkboxes)

What the extension collects or handles, and why. Tick exactly these:

| Category | Tick | What and why |
| --- | --- | --- |
| Personally identifiable information | Yes | The user's contact details from their Aplica career profile (name, email, phone, city, LinkedIn, GitHub, website), received from Aplica only to fill in the application form the user asks for. Never stored by the extension. |
| Health information | No | |
| Financial and payment information | No | The salary of a job posting is not the user's financial information. Payments happen only on the Aplica website. |
| Authentication information | Yes | The access token that connects the browser to the user's Aplica account, kept in storage.local and sent to the Aplica API. |
| Personal communications | No | |
| Location | No | Only the city the user wrote in their profile, covered under personally identifiable information. No IP or GPS location. |
| Web history | Yes | The link of the job posting the user saves or checks, sent to Aplica to save the posting and to warn about duplicates. No other browsing history. |
| User activity | No | No clicks, keystrokes or scrolling are monitored. |
| Website content | Yes | The text of the job posting the user chooses to save (title, company, location, work mode, salary, description), and whether the page is an application confirmation page on the seven supported systems. |

Text for the "data usage" justification, if asked:

```text
The extension only handles data to provide its single purpose. It reads the job posting on the tab where the user clicks the icon and sends it to the user's Aplica account when the user presses "Save to Aplica"; to warn about duplicates it sends the link, job title and company, which Aplica compares with the user's applications without storing them. It receives the user's own contact details from Aplica to fill in the form the user asks for, in the browser. It keeps only the access token and the account language in storage.local. There is no third-party analytics or code in the extension: usage is counted by the Aplica server with events that carry no account, email, IP address or identifier.
```

## Certifications

Tick the three:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

```text
https://aplica.cv/en/legal/privacy
```

## Notes for the Edge Add-ons certification team

```text
To test the extension you need an Aplica account. Test account: [email and password of the test account, filled in when submitting]. After installing, click the Aplica icon, press "Connect with Aplica", sign in with the test account and approve. Then open any job posting (for example on LinkedIn or a Greenhouse board), click the icon and press "Save to Aplica". The extension never submits application forms. The source code is public at [GitHub repository URL, filled in when submitting].
```
