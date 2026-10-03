# Test suite

Zero dependencies. Node's built-in runner, nothing to install, works offline.

```bash
npm test              # the suite (95 checks, ~2s)
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
| `../testkit/helpers.cjs` | Loads the built page; `codeOnly()` strips comments and string bodies while keeping `${...}` interpolations, so scanners do not mistake prose for source |
| `structure.test.cjs` | Parse, CSS integrity, build tokens, DOM ids, undefined globals, SRI, secrets |
| `data.test.cjs` | i18n key coverage, station/bus coordinates, fares, disruption shape, translation quality |
| `translator.test.cjs` | Turkish→English/Arabic/French disruption translator: no welded suffixes, case endings resolved, every rule complete in all three languages, and the coverage fallback that shows the Turkish original rather than a hybrid |
| `../testkit/verify-suite.cjs` | Mutation check — breaks a copy of the build 66 ways and requires the right test to fail |

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

## Tier 2 — browser smoke tests

`transit_data/test/smoke.html` boots the real built page in an iframe and exercises it. This
is the tier static analysis cannot reach: a runtime throw, a dead boot, a map that never
renders. Open it directly, or press **Run browser tests** on `/status.html`.

Fourteen checks: boot, uncaught errors, map size, tile loading, animated counters, search, the
planner, the assistant answering from local data, an untranslatable alert falling back to
labelled Turkish, Arabic laying out right-to-left with each language getting its own alert
text, service-worker registration — and the one that matters most:

**A never-laid-out map must not cost the user an answer.** `dropPin` used to call `flyTo`
unconditionally; a container that never laid out projects to `NaN`, `flyTo` threw, and the
surrounding catch turned it into "I couldn't match that" — a wrong answer rather than a crash.

Reproducing it correctly took two attempts. Shrinking a *booted* map is not enough: Leaflet
keeps a valid cached centre, so the mutant passed. The app has to **boot at zero size**, as it
does in a background tab or behind a sheet. The check now spins up its own 0×0 iframe. Verified
against a mutant with the `mapUsable()` guard removed: it fails with the exact original
symptom, and passes on the real build.

Checks that need real painting (`requestAnimationFrame`, tile fetches, layout) **skip** rather
than fail when the document is hidden. Run it in a visible window.

`?app=<url>` aims the suite at a different build — that is how the mutant above was tested.

## The status dashboard

`/status.html` — open it in its own window and keep it there. It reads `status.json`, which
`transit_data/gen-status.cjs` generates **into the Pages artifact at deploy time and never
commits**, so the dashboard is exactly as fresh as the live site and the repo stays free of
churn. Locally: `npm run status`.

It shows the static suite result, city coverage, live service alerts, roadmap progress from
`transit_data/roadmap.json`, and it can run the browser suite live in an embedded frame.

## Where the application source lives

`transit_data/src/*.js` — 20 files, concatenated **in filename order** by `build.cjs` into the
single inline script the page ships. Edit those, never `index.html`.

The split was made safe by requiring the assembled output to be **byte-identical** to the file
it replaced. On a codebase with one shared scope that is the whole argument: same order, same
bytes, so no declaration-order or hoisting behaviour can have changed. The verification found
exactly one difference — a single extra newline before `</script>` — which was fixed before
anything else was touched.

**This buys navigability, not isolation.** Joined, the 20 files are still one scope; a name
collision is exactly as possible as it was. Real isolation needs ES modules, and this is the
step that makes that conversion approachable rather than the conversion itself.

Concatenation rather than a bundler is deliberate: the app is one self-contained HTML file that
works from `file://` with no tooling, and a bundler would add a dependency this machine cannot
reliably install. `structure.test.cjs` asserts the shipped script really is the concatenated
source, so an orphaned file or an edit made to the built page instead of the source is caught.

## The shared scope, and why it stays shared

`npm run scope` (`transit_data/testkit/analyse-scope.cjs`) measures what the concatenated scope
actually costs. Two checks in `scope.test.cjs` enforce the result:

- **No two source files declare the same top-level name.** This is the real risk the audit
  named, and it now fails the build the moment it appears rather than letting one declaration
  silently win. Proven by introducing a duplicate `svgEsc`: the guard names both files.
- **The evaluation-time dependency graph stays acyclic.** Cycles through function bodies are
  harmless — the binding resolves when the function is called. A cycle at *load* time throws on
  a temporal dead zone, and would also close off any future move to ES modules.

**Full ES-module isolation was measured and declined.** There are zero collisions today, so the
risk is unrealised, and the guard above gives the same protection for a fraction of the cost.
Conversion is genuinely feasible — the evaluation-time graph is acyclic — but it means exports
and imports across 509 top-level names plus a bundler this machine cannot reliably install.
Revisit if collisions start appearing, if more than one person is editing, or if code-splitting
becomes necessary.

A caution about the analysis itself: the first two runs said "one 20-file cycle" and then "one
2-file cycle", and both were artefacts. The tool was counting `arr.map(...)` as a reference to
the `map` object — the same lookbehind mistake the undefined-global check had. Corrected, the
answer is zero. It would have argued against a refactor on false evidence.

## Half-translated alerts: a measured fallback, never an invented translation

The disruption translator (`scrape-disruptions.cjs`, between the `TRANSLATOR` markers, spliced
into the page by `build.cjs`) is ordered phrase substitution. It covers the formulaic half of
metro.istanbul's announcements very well and knows nothing else, so an alert with an unusual
clause used to come back as a hybrid. This really shipped, on M2:

> Sanayi at the station bir yolcunun intihar girişiminde bulunması due to Sanayi our station
> işletmeye has been closed.

Half of each language, readable in neither. The old guard, `hasResidualTurkish()`, is a keyword
list — it asks *is any known Turkish left*, which both over-fires (one stray `hizmet` condemns a
clean sentence) and under-fires (nothing in that sentence is on the list).

What matters is the **proportion**, and it can be measured exactly rather than guessed at: every
English word `translateTR` can emit comes from the replacement side of the rule tables, so a word
in the output that is not in that vocabulary and is not a proper noun is, by construction, source
text no rule matched. `turkishShare()` returns that fraction; `bestEffortEnglish()` compares it
to `TR_FALLBACK_SHARE` and returns either the translation or **the untouched Turkish original**,
tagged `lang`. It never writes English the rules could not derive.

The threshold is **0.25**, and it sits in a gap rather than in the middle of the data: the alerts
the rules do cover measure 0.00–0.17, the ones they do not measure 0.37 and up. `translator.test.cjs`
pins both populations *and* requires 0.05 of daylight either side, so a threshold quietly nudged
into the crowd fails rather than becoming a coin-flip.

Station and line names are passed in and excluded from the count — they survive translation by
design, and an alert should not score worse for naming more places.

### Four languages, not one with three decorations

The app offers English, Turkish, Arabic and French, and for a long time only the first two were
real. Two mechanisms hid it. `t()` falls back to English without saying so, and under that
fallback `ar` and `fr` drifted **101 keys** behind — about a fifth of the interface, including
the whole interchange vocabulary, the whole assistant, provenance and diagnostics. And the
disruption rules carried a single English replacement each, so an Arabic or French reader got
the English sentence or the untranslated Turkish, but never their own language.

Both are now checked rather than trusted:

- **`every language covers the keys English defines`** — no language may rely on the fallback.
- **`a translated string keeps every placeholder its English original has`** — `{n}` is
  substituted with `.replace()`, so a translation that drops it prints a sentence with the
  number silently missing rather than failing.
- **`the Arabic dictionary is in Arabic`** — an entry left as the English string is a
  translation nobody did, and it looks identical to one that was.
- **`every rule says what it produces in every language`** — a rule added with only an English
  replacement would degrade Arabic and French for every announcement it matched, in silence.
- **`a covered alert is translated into each language`**, and the three outputs must differ:
  identical text means one table is a copy of another.

The fallback to the Turkish original is decided **per language**, because the rules can cover an
announcement well in one and badly in another, and each reader is owed the honest answer for the
language they are actually reading.

Arabic also needs `dir="rtl"`, which the page never set — it set `lang` alone, so Arabic
sentences were laid out as English and, because the bidi algorithm takes its base direction from
exactly that attribute, a mixed run like `M2 إلى Kadıköy` came out with its parts in the wrong
order. Latin names that must keep their own direction (the masthead, the bus operator tag) are
isolated in the `[dir="rtl"]` block in the stylesheet.

When the original is shown, the UI says so: an `ann-tr` badge reading “Turkish original”, with
the reason in its `title`. It appears only for readers who are *not* reading Turkish, since a
Turkish reader needs no explanation. `ensureEnglish()` re-derives the decision on load from
`messageTr` with the **deployed** rules, so a hybrid baked into an older feed cannot outlive the
phrase rule that fixes it — and hand-written entries (`source:"manual"`) and LLM translations are
left exactly as written, because judging their English by the rules' own small vocabulary would
only mistake ordinary words for Turkish.
