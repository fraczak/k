#!/usr/bin/env node

import assert from "node:assert/strict";
import { annotate } from "./index.mjs";
import { hash } from "./hash.mjs";

const nameRegex = /^[a-zA-Z0-9_+][a-zA-Z0-9_?!+]*$/;

function hashBody(h) {
  assert.ok(h.startsWith("@"), "hash must start with @");
  return h.slice(1);
}

function getRelHash(script, name) {
  const { relAlias } = annotate(script);
  assert.ok(relAlias[name], `missing relAlias for ${name}`);
  return relAlias[name];
}

// Hash format invariants
{
  const h = hash("abc");
  assert.ok(nameRegex.test(hashBody(h)), "hash body must match k-name regex");
}

// Alpha-renaming of local references should not change hash
{
  const scriptA = `
g = ();
f = g;
f
  `;

  const scriptB = `
h = ();
f = h;
f
  `;

  assert.equal(
    getRelHash(scriptA, "f"),
    getRelHash(scriptB, "f"),
    "alpha renaming should be stable"
  );
}

// Direct alias vs inline definition should not change hash
{
  const scriptAlias = `
g = ();
f = g;
f
  `;

  const scriptInline = `
f = ();
f
  `;

  assert.equal(
    getRelHash(scriptAlias, "f"),
    getRelHash(scriptInline, "f"),
    "alias vs inline should be stable"
  );
}

// SCC order should not change hash
{
  const scriptA = `
$bit = < {} 0, {} 1 >;
f = $bit < /0 |0 g, /1 >;
g = $bit < /0 |0 f, /1 >;
f
  `;

  const scriptB = `
$bit = < {} 0, {} 1 >;
g = $bit < /0 |0 f, /1 >;
f = $bit < /0 |0 g, /1 >;
f
  `;

  assert.equal(
    getRelHash(scriptA, "f"),
    getRelHash(scriptB, "f"),
    "SCC order should be stable"
  );
}

// Union ordering should be significant
{
  const scriptA = `
x = < x, y >;
y = x;
x
  `;

  const scriptB = `
x = < y, x >;
y = x;
x
  `;

  assert.notEqual(
    getRelHash(scriptA, "x"),
    getRelHash(scriptB, "x"),
    "union ordering should be significant"
  );
}

// Product ordering should be significant
{
  const scriptA = `
a = ();
b = ();
x = { a a, b b };
x
  `;

  const scriptB = `
a = ();
b = ();
y = { b b, a a };
y
  `;

  assert.notEqual(
    getRelHash(scriptA, "x"),
    getRelHash(scriptB, "y"),
    "product ordering should be significant"
  );
}

console.log("test-hash-normalization: ok");
