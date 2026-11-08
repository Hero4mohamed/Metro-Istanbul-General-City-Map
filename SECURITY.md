# Security policy

İstanbul Ray-Net is a free, non-commercial, open-source project by one person. It has no server, no accounts and no database of
users: it is a set of static files on GitHub Pages, and what people save stays in their own browser. That keeps the attack surface
small, but not zero, and a report is welcome.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use either:

- GitHub's private reporting: **Security → Report a vulnerability** on this repository, or
- e-mail **mohamedyounis248@gmail.com** with "SECURITY" in the subject.

Say what you found, how to reproduce it (a URL, steps, a screenshot), and what you think the impact is. You will get an answer
within a week; this is a personal project, so a fix date cannot be promised, but anything that exposes a visitor's data or lets
someone else's content run in the app is treated as urgent. Please give a reasonable time to fix it before publishing. There is no
bug bounty. Good-faith research that stays within this site is welcome; please do not test against the third-party services the app
uses (they have their own policies), do not attack the map, weather or routing hosts, and do not access anyone else's data.

## What is already in place

- **A strict Content-Security-Policy** (as a `<meta>` tag, since GitHub Pages cannot set headers): the app's one inline script is
  allowed by its hash only, no `eval`, no inline event handlers, no framing (`frame-src 'none'`), no forms, and only the listed
  hosts can be contacted. The list is in `transit_data/build.cjs` and, in plain words, in `legal/privacy.html`; a test fails if they
  disagree.
- **Nothing third-party is loaded on a normal visit**: Leaflet, MapLibre and the typefaces ship with the app, each with its licence
  and a recorded SHA-384 (`vendor/README.md`); a test fails if a file changes without the record.
- **Text from outside is text, never markup**: notices scraped from operators, İBB's timetable data, place-search results and the
  AI assistant's answers are escaped before they reach the page (tests run hostile strings through the real code).
- **No tracking, no cookies, no analytics.** What is stored on a device is listed in `legal/storage.html`, all under the `irn_` prefix,
  and removable in one tap.
- **The app refuses to run inside another site's frame** (clickjacking), and its links to other sites use `rel="noopener"`.
- **The build and the tests**: the committed page must equal a rebuild; a mutation check proves the tests can still fail; the GitHub
  Actions this repository runs are pinned to exact commits and kept current by Dependabot.
- **Secrets**: none are in the repository (a test looks for key-shaped strings). The only key the app ever touches is one a user may
  paste in themselves for the optional assistant; it stays in that browser.

## Known limits

- Without response headers, `frame-ancestors`, `X-Content-Type-Options`, `Permissions-Policy` and HSTS preload cannot be set by this
  project (GitHub Pages sets HSTS itself). If the app is ever moved to a host that allows headers, set them.
- The style rules allow inline styles (`style-src 'unsafe-inline'`) because the app writes many `style=""` attributes; the script
  rules, which matter most, do not.
- The notices come from operators' public pages and feeds that this project does not control; they are escaped, but their content is
  theirs.
