# Test suite

Zero dependencies. Node's built-in runner, nothing to install, works offline.

```bash
npm test              # the suite (18 checks, ~1s)
npm run test:mutation # prove the suite can still fail
npm run verify        # build + suite + mutation check
```

## What this is for

Every check here exists because the corresponding defect **actually shipped**. This is a
regression suite, not a wish list. On 14–15 Aug 2026 two separate changes killed the entire
application and reached `main`, because nothing inspected the built artifact:

- a patch script expanded a `$&` inside a replacement string and spliced source into the
  middle of a statement — the page loaded, Leaflet loaded, and the app was dead
- `escapeHtml()` was called 57 times and defined nowhere, so every assistant answer threw and
  the surrounding `catch` turned it into a polite "I couldn't match that"

Both were caught by a human happening to open a browser. That is what this replaces.

## The suite reads the BUILT artifact

`index.html`, not `app.template.html`. The template is what you edit; `index.html` is what a
user receives, and both outages above existed only *after* the build step ran. `test.yml` also
rebuilds and diffs, so an edited-but-not-rebuilt template fails rather than quietly validating
a stale file.

## Files

| File | Purpose |
|---|---|
| `helpers.cjs` | Loads the built page; `codeOnly()` strips comments and string bodies while keeping `${...}` interpolations, so scanners do not mistake prose for source |
| `structure.test.cjs` | Parse, CSS integrity, build tokens, DOM ids, undefined globals, SRI, secrets |
| `data.test.cjs` | i18n key coverage, station/bus coordinates, fares, disruption shape, translation quality |
| `verify-suite.cjs` | Mutation check — breaks a copy of the build 7 ways and requires the right test to fail |

## The mutation check is not optional

A suite that has never failed proves nothing. `verify-suite.cjs` reintroduces each historical
defect into a *copy* of `index.html` and asserts the matching test goes red. It has already
caught two faulty tests of its own: one anchored on a function form that does not exist, and
one whose "undefined global" scan consumed the `(` in `aiSay(escapeHtml(` so it never saw the
inner call. Run it whenever you add or change a check.

## The one ratchet

`data.test.cjs` pins `ORPHAN_BASELINE = 65`: İstanbul's İETT graph holds 40 route refs (14E,
19FB, 29Ş, 34A and others) that the directory scrape never picked up, so the planner can route
over them but the Buses list cannot show them. That is a real gap in `fetch-bus-gtfs.cjs` and
it predates this suite. Failing the build on it would only teach people to skip tests, so the
number may **shrink, never grow**. Lower the baseline when the pipeline improves.

## Where it runs

| Workflow | Why |
|---|---|
| `test.yml` | Every push and PR — plus a build-drift diff and the mutation check |
| `pages.yml` | Before uploading the artifact, so a broken build cannot be published |
| `disruptions.yml` | Before committing a scrape — it has shipped a zero-length segment and a half-translated sentence |
| `accessibility.yml`, `bus-gtfs.yml` | Before committing a rebuilt `index.html` |

## Not covered yet

This is a static suite. It cannot catch a runtime fault in a real browser — the zero-size-map
`flyTo` throw would still get through. A DOM smoke test is the next layer.
