/* Measure the shared-scope surface of transit_data/src.
 *
 * The 20 source files are concatenated into one scope, so every top-level name is global to all
 * of them. Two questions decide whether real module isolation is worth attempting:
 *   1. Are there collisions TODAY? A duplicate top-level name is a live bug, not a hypothetical.
 *   2. What does the dependency graph look like? ES modules handle cycles badly for bindings
 *      used during module evaluation, so a heavily cyclic graph makes conversion expensive and
 *      risky, while a layered one makes it routine.
 *
 * Usage: node transit_data/testkit/analyse-scope.cjs [--json]
 */
const fs = require('fs');
const path = require('path');
const H = require('./helpers.cjs');

const SRC = path.join(H.DATA, 'src');
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.js')).sort();

/* Top-level declarations only: a name declared inside a function is not shared. Brace depth is
   tracked over code with comments and string bodies already removed, so a brace inside a string
   cannot throw the count off. */
function topLevelDeclarations(code) {
  const names = new Map();          // name -> kind
  let depth = 0, paren = 0;
  const lines = code.split('\n');
  for (const line of lines) {
    if (depth === 0 && paren === 0) {
      let m;
      if ((m = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line))) names.set(m[1], 'function');
      else if ((m = /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line))) names.set(m[1], 'binding');
      else if ((m = /^\s*class\s+([A-Za-z_$][\w$]*)/.exec(line))) names.set(m[1], 'class');
    }
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '(') paren++;
      else if (ch === ')') paren--;
    }
    if (depth < 0) depth = 0;
    if (paren < 0) paren = 0;
  }
  return names;
}

const decls = new Map();            // file -> Map(name -> kind)
const codes = new Map();            // file -> stripped code
for (const f of files) {
  const code = H.codeOnly(fs.readFileSync(path.join(SRC, f), 'utf8'));
  codes.set(f, code);
  decls.set(f, topLevelDeclarations(code));
}

/* --- 1. collisions --- */
const owner = new Map();            // name -> [files]
for (const [f, names] of decls) {
  for (const n of names.keys()) {
    if (!owner.has(n)) owner.set(n, []);
    owner.get(n).push(f);
  }
}
const collisions = [...owner.entries()].filter(([, fs2]) => fs2.length > 1);

/* Evaluation-time code only: everything that actually RUNS when the script loads.
 *
 * This is the distinction that decides feasibility. A cycle whose cross-references all sit
 * inside function bodies is harmless under ES modules — the binding is resolved when the
 * function is eventually called, long after every module has evaluated. A cycle with
 * references at evaluation time is the one that throws on a temporal dead zone. Removing
 * function bodies leaves exactly the code that runs during load. */
function evalTimeCode(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    // a function body, from a declaration or an expression, is deferred — skip it wholesale
    const rest = code.slice(i, i + 400);
    const fn = /^(?:async\s+)?function\s*[\w$]*\s*\([^)]*\)\s*\{/.exec(rest)
            || /^\([^()]*\)\s*=>\s*\{/.exec(rest)
            || /^[A-Za-z_$][\w$]*\s*=>\s*\{/.exec(rest);
    if (fn) {
      i += fn[0].length;
      let depth = 1;
      while (i < n && depth > 0) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') depth--;
        i++;
      }
      out += ' ';
      continue;
    }
    out += code[i];
    i++;
  }
  return out;
}

/* --- 2. cross-file references --- */
const edges = new Map();            // file -> Set(file it depends on)
for (const f of files) edges.set(f, new Set());
for (const [f, code] of codes) {
  const used = new Set((code.match(/(?<![.\w$])[A-Za-z_$][\w$]*/g) || []));
  for (const n of used) {
    const from = owner.get(n);
    if (!from || from.length !== 1) continue;      // unknown or ambiguous
    const src = from[0];
    if (src !== f && !decls.get(f).has(n)) edges.get(f).add(src);
  }
}

/* --- 3. cycles (Tarjan) --- */
const index = new Map(), low = new Map(), onStack = new Set(), stack = [];
const sccs = [];
let counter = 0;
function strongconnect(v) {
  index.set(v, counter); low.set(v, counter); counter++;
  stack.push(v); onStack.add(v);
  for (const w of edges.get(v) || []) {
    if (!index.has(w)) { strongconnect(w); low.set(v, Math.min(low.get(v), low.get(w))); }
    else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
  }
  if (low.get(v) === index.get(v)) {
    const comp = [];
    let w;
    do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
    sccs.push(comp);
  }
}
for (const f of files) if (!index.has(f)) strongconnect(f);
const cycles = sccs.filter(c => c.length > 1);

/* --- 3b. the graph that actually decides feasibility: evaluation-time only --- */
const evalEdges = new Map();
for (const f of files) evalEdges.set(f, new Set());
for (const f of files) {
  const used = new Set((evalTimeCode(codes.get(f)).match(/(?<![.\w$])[A-Za-z_$][\w$]*/g) || []));
  for (const nm of used) {
    const from = owner.get(nm);
    if (!from || from.length !== 1) continue;
    if (from[0] !== f && !decls.get(f).has(nm)) evalEdges.get(f).add(from[0]);
  }
}
const ei = new Map(), el = new Map(), eon = new Set(), est = [];
const esccs = []; let ec = 0;
function estrong(v) {
  ei.set(v, ec); el.set(v, ec); ec++;
  est.push(v); eon.add(v);
  for (const w of evalEdges.get(v) || []) {
    if (!ei.has(w)) { estrong(w); el.set(v, Math.min(el.get(v), el.get(w))); }
    else if (eon.has(w)) el.set(v, Math.min(el.get(v), ei.get(w)));
  }
  if (el.get(v) === ei.get(v)) {
    const comp = []; let w;
    do { w = est.pop(); eon.delete(w); comp.push(w); } while (w !== v);
    esccs.push(comp);
  }
}
for (const f of files) if (!ei.has(f)) estrong(f);
const evalCycles = esccs.filter(c => c.length > 1);

const report = {
  files: files.length,
  topLevelNames: owner.size,
  collisions: collisions.map(([n, fs2]) => ({ name: n, files: fs2 })),
  edges: Object.fromEntries([...edges].map(([f, s]) => [f, [...s].sort()])),
  cycles: cycles.map(c => c.sort()),
  acyclic: cycles.length === 0,
  evalCycles: evalCycles.map(c => c.sort()),
  evalAcyclic: evalCycles.length === 0,
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('source files          : ' + report.files);
  console.log('top-level names shared: ' + report.topLevelNames);
  console.log('');
  console.log('COLLISIONS (same name declared in two files): ' + collisions.length);
  for (const c of report.collisions) console.log('  ' + c.name + '  <- ' + c.files.join(', '));
  console.log('');
  console.log('DEPENDENCY CYCLES: ' + cycles.length +
    (cycles.length ? ' (ES modules evaluate these in an order that can leave bindings undefined)' : ''));
  for (const c of report.cycles) {
    console.log('  ' + c.length + ' files: ' + c.join(' <-> '));
  }
  console.log('');
  console.log('EVALUATION-TIME CYCLES (the ones that would actually break): ' + evalCycles.length);
  for (const c of evalCycles.map(c => c.sort())) console.log('  ' + c.length + ' files: ' + c.join(' <-> '));
  const evalLeaves = files.filter(f => (evalEdges.get(f) || new Set()).size === 0);
  console.log('  files with no evaluation-time dependency: ' + evalLeaves.length + '/' + files.length);
  console.log('');
  const fanIn = new Map();
  for (const [, deps] of edges) for (const d of deps) fanIn.set(d, (fanIn.get(d) || 0) + 1);
  console.log('most depended-upon files:');
  [...fanIn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .forEach(([f, n]) => console.log('  ' + String(n).padStart(2) + ' <- ' + f));
  const leaves = files.filter(f => (edges.get(f) || new Set()).size === 0);
  console.log('');
  console.log('files depending on nothing else (convertible first): ' +
    (leaves.length ? leaves.join(', ') : 'none'));
}
