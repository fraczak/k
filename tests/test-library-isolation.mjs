import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import k, { parse } from "../index.mjs";
import { Value } from "../Value.mjs";
import { resolvePatternCanonicalInfo } from "../canonical-pattern.mjs";
import { validatePatternDefinitions } from "../named-patterns.mjs";
import {
  compileObject,
  compileObjectBuffer,
  compileLibrary,
  compileLibraryBuffer,
  loadLibrary,
  decodeObject,
  objectToFunction
} from "../object.mjs";
import { createState, evaluateInput } from "../repl.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const compileMjs = path.join(root, "objects/compile.mjs");
const kMjs = path.join(root, "k.mjs");
const kPrintMjs = path.join(root, "codecs/k-print.mjs");
const unitParseMjs = path.join(root, "codecs/unit.mjs");

function runCommand(cmd, args, options = {}) {
  const encoding = options.encoding !== undefined ? options.encoding : "utf8";
  const result = spawnSync(cmd, args, {
    cwd: root,
    ...options,
    encoding
  });
  return result;
}

console.log("==> Starting Library Isolation & Scope Binding Tests");

// -----------------------------------------------------------------------------
// §1. Relation Content-Addressable Isolation & Explicit Scope Binding
// -----------------------------------------------------------------------------
console.log("--> Test 1: Relations - Content-Addressable Isolation and --use");
{
  const libSource = `
    greet = {} |hello;
    secret = {} |classified;
  `;
  const libObject = compileLibrary(libSource, { source: "test-lib1.k" });
  const library = loadLibrary(libObject);

  const greetHash = library.relAlias.greet;
  const secretHash = library.relAlias.secret;
  assert.ok(greetHash && greetHash.startsWith("@"), `Expected @hash for greet, got ${greetHash}`);
  assert.ok(secretHash && secretHash.startsWith("@"), `Expected @hash for secret, got ${secretHash}`);

  // 1.1 Without --use / useSpecs: friendly name 'greet' is NOT in scope
  assert.throws(
    () => compileObject("greet", { libraries: [library] }),
    /No definition found for 'greet'/,
    "Expected friendly name 'greet' to be inaccessible without --use"
  );

  // 1.2 Without --use / useSpecs: friendly name 'secret' is NOT in scope
  assert.throws(
    () => compileObject("secret", { libraries: [library] }),
    /No definition found for 'secret'/,
    "Expected friendly name 'secret' to be inaccessible without --use"
  );

  // 1.3 Without --use / useSpecs: accessing @greetHash directly by hash SUCCEEDS
  const objByHash = compileObject(greetHash, { libraries: [library] });
  const resByHash = objectToFunction(objByHash)(Value.product({}));
  assert.equal(resByHash.tag, "hello", "Accessing library relation by @hash must succeed");

  // 1.4 Accessing @secretHash directly by hash SUCCEEDS
  const objSecretHash = compileObject(secretHash, { libraries: [library] });
  const resSecret = objectToFunction(objSecretHash)(Value.product({}));
  assert.equal(resSecret.tag, "classified", "Accessing secret relation by @hash must succeed");

  // 1.5 With explicit useSpecs: ["greet"]:
  //     'greet' is in scope, but 'secret' remains isolated
  const objWithGreet = compileObject("greet", {
    libraries: [library],
    useSpecs: ["greet"]
  });
  const resGreet = objectToFunction(objWithGreet)(Value.product({}));
  assert.equal(resGreet.tag, "hello", "'greet' must be in scope when specified via useSpecs");

  assert.throws(
    () => compileObject("secret", { libraries: [library], useSpecs: ["greet"] }),
    /No definition found for 'secret'/,
    "'secret' must NOT be in scope when only 'greet' was requested"
  );

  // 1.6 With aliasing useSpecs: ["greet:custom_hello"]:
  //     'custom_hello' is in scope; 'greet' is NOT
  const objAliased = compileObject("custom_hello", {
    libraries: [library],
    useSpecs: ["greet:custom_hello"]
  });
  const resAliased = objectToFunction(objAliased)(Value.product({}));
  assert.equal(resAliased.tag, "hello", "Aliased name 'custom_hello' must resolve");

  assert.throws(
    () => compileObject("greet", { libraries: [library], useSpecs: ["greet:custom_hello"] }),
    /No definition found for 'greet'/,
    "Original name 'greet' must NOT be in scope when aliased to 'custom_hello'"
  );
}
console.log("    Passed: Relation isolation and explicit scope binding verified.");

// -----------------------------------------------------------------------------
// §2. Pattern Template Content-Addressable Isolation & Explicit Scope Binding
// -----------------------------------------------------------------------------
console.log("--> Test 2: Pattern Templates - Content-Addressable Isolation and --use");
{
  const libSource = `
    pair[A, B] = { A first, B second };
    triple[A, B, C] = { A first, B second, C third };
  `;
  const libObject = compileLibrary(libSource, { source: "test-patterns.k" });
  const library = loadLibrary(libObject);

  const pairHash = library.patternAlias.pair;
  const tripleHash = library.patternAlias.triple;
  assert.ok(pairHash && pairHash.startsWith("@"), `Expected @hash for pair, got ${pairHash}`);
  assert.ok(tripleHash && tripleHash.startsWith("@"), `Expected @hash for triple, got ${tripleHash}`);

  // 2.1 Without useSpecs: 'pair[]' is NOT in scope
  assert.throws(
    () => compileObject("is_pair = ?pair[{}, {}]; ()", { libraries: [library] }),
    /Unknown pattern template 'pair\[\]'/,
    "Expected pattern template 'pair[]' to be inaccessible without --use"
  );

  // 2.2 Without useSpecs: 'triple[]' is NOT in scope
  assert.throws(
    () => compileObject("is_triple = ?triple[{}, {}, {}]; ()", { libraries: [library] }),
    /Unknown pattern template 'triple\[\]'/,
    "Expected pattern template 'triple[]' to be inaccessible without --use"
  );

  // 2.3 Accessing @pairHash directly by hash SUCCEEDS
  const objPairHash = compileObject(`
    is_pair = ?${pairHash}[{}, {}];
    {{} first, {} second} is_pair
  `, { libraries: [library] });
  const resPair = objectToFunction(objPairHash)(Value.product({}));
  assert.equal(resPair.type, "{}");

  // 2.4 With explicit useSpecs: ["pair"]:
  //     'pair[]' is in scope; 'triple[]' remains isolated
  const objPairUse = compileObject(`
    is_pair = ?pair[{}, {}];
    {{} first, {} second} is_pair
  `, {
    libraries: [library],
    useSpecs: ["pair"]
  });
  const resPairUse = objectToFunction(objPairUse)(Value.product({}));
  assert.equal(resPairUse.type, "{}");

  assert.throws(
    () => compileObject("is_triple = ?triple[{}, {}, {}]; ()", {
      libraries: [library],
      useSpecs: ["pair"]
    }),
    /Unknown pattern template 'triple\[\]'/,
    "'triple[]' must NOT be in scope when only 'pair' was requested"
  );

  // 2.5 With aliasing useSpecs: ["pair:two_tuple"]:
  const objPairAliased = compileObject(`
    is_two = ?two_tuple[{}, {}];
    {{} first, {} second} is_two
  `, {
    libraries: [library],
    useSpecs: ["pair:two_tuple"]
  });
  const resPairAliased = objectToFunction(objPairAliased)(Value.product({}));
  assert.equal(resPairAliased.type, "{}");

  assert.throws(
    () => compileObject("is_pair = ?pair[{}, {}]; ()", {
      libraries: [library],
      useSpecs: ["pair:two_tuple"]
    }),
    /Unknown pattern template 'pair\[\]'/
  );
}
console.log("    Passed: Pattern template isolation and explicit scope binding verified.");

// -----------------------------------------------------------------------------
// §3. Local Definitions vs Unused Library Definitions (No Shadowing Ambiguity)
// -----------------------------------------------------------------------------
console.log("--> Test 3: Local definitions and unused library symbols");
{
  const libSource = `
    foo = {} |library_foo;
    byte[] = { <{} 0, {} 1> b0, <{} 0, {} 1> b1 };
    box[] = { byte[] item };
  `;
  const library = loadLibrary(compileLibrary(libSource, { source: "lib-foo.k" }));
  const fooHash = library.relAlias.foo;
  const libBoxHash = library.patternAlias.box;

  // Helper to capture console.warn during compilation
  function captureWarnings(fn) {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    try {
      const value = fn();
      return { value, warnings };
    } finally {
      console.warn = origWarn;
    }
  }

  // Local file defines its own 'foo' without --use foo.
  // Also defines its own 'byte[]' and 'wrap[] = { byte[] item }' without --use byte[].
  // Neither relation nor pattern resolution may leak library names or warn.
  const source = `
    foo = {} |local_foo;
    call_local = foo;
    call_lib = ${fooHash};
    { call_local local, call_lib lib }
  `;
  const { value: compiled, warnings: relWarnings } = captureWarnings(() =>
    compileObject(source, { libraries: [library] })
  );
  assert.equal(relWarnings.length, 0, `Unexpected warning without --use: ${relWarnings}`);
  const result = objectToFunction(compiled)(Value.product({}));
  assert.equal(result.product.local.tag, "local_foo");
  assert.equal(result.product.lib.tag, "library_foo");

  // Compile library redefining 'byte[]' locally without --use byte[]
  const localWrapSource = `
    byte[] = { <{} 0, {} 1> x0, <{} 0, {} 1> x1 };
    wrap[] = { byte[] item };
  `;
  const expectedStandalone = loadLibrary(compileLibrary(localWrapSource, { source: "standalone.k" }));
  const { value: chainedLibRaw, warnings: patWarnings } = captureWarnings(() =>
    compileLibrary(localWrapSource, { source: "local-wrap.k", libraries: [library] })
  );
  const chainedLib = loadLibrary(chainedLibRaw);
  assert.equal(patWarnings.length, 0, `Unexpected warning without --use: ${patWarnings}`);
  assert.equal(
    chainedLib.patternAlias.wrap,
    expectedStandalone.patternAlias.wrap,
    "wrap[] must hash against local byte[], not un-imported library byte[]"
  );
  assert.equal(
    chainedLib.patternAlias.box,
    libBoxHash,
    "Un-modified inherited pattern box[] must keep its original hash"
  );

  // Referencing library's 'byte[]' in compileLibrary without --use or local definition must fail
  assert.throws(
    () => compileLibrary("bad_wrap[] = { byte[] item };", { source: "bad.k", libraries: [library] }),
    /Unknown pattern template 'byte\[\]'/,
    "compileLibrary must not leak library pattern friendly names without --use"
  );
}
console.log("    Passed: Local definitions and library symbols do not clash without --use.");

// -----------------------------------------------------------------------------
// §4. CLI Invocations (compile.mjs and k.mjs)
// -----------------------------------------------------------------------------
console.log("--> Test 4: CLI enforcement of isolation and --use");
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-test-isolation-"));
  try {
    const libPath = path.join(tmpDir, "sample.klib");
    const libSource = "greeting = {} |welcome; secret = {} |hidden;";
    fs.writeFileSync(path.join(tmpDir, "sample.k"), libSource, "utf8");

    // Build sample.klib
    const buildLib = runCommand(node, [compileMjs, path.join(tmpDir, "sample.k"), libPath]);
    assert.equal(buildLib.status, 0, buildLib.stderr);

    const libObj = decodeObject(fs.readFileSync(libPath));
    const greetingHash = libObj.relAlias.greeting;
    assert.ok(greetingHash && greetingHash.startsWith("@"));

    // 4.1 CLI compile.mjs without --use: referencing 'greeting' fails
    const failCompile = runCommand(node, [
      compileMjs,
      "--lib", libPath,
      "greeting",
      path.join(tmpDir, "fail.ko")
    ]);
    assert.notEqual(failCompile.status, 0);
    assert.match(failCompile.stderr, /No definition found for 'greeting'/);

    // 4.2 CLI compile.mjs referencing @greetingHash succeeds
    const hashKo = path.join(tmpDir, "hash.ko");
    const passHashCompile = runCommand(node, [
      compileMjs,
      "--lib", libPath,
      greetingHash,
      hashKo
    ]);
    assert.equal(passHashCompile.status, 0, passHashCompile.stderr);
    assert.ok(fs.existsSync(hashKo));

    // 4.3 CLI compile.mjs with --use greeting succeeds
    const greetKo = path.join(tmpDir, "greet.ko");
    const passUseCompile = runCommand(node, [
      compileMjs,
      "--lib", libPath,
      "--use", "greeting",
      "greeting",
      greetKo
    ]);
    assert.equal(passUseCompile.status, 0, passUseCompile.stderr);
    assert.ok(fs.existsSync(greetKo));

    // 4.4 CLI compile.mjs with --use greeting:my_hello succeeds
    const aliasKo = path.join(tmpDir, "alias.ko");
    const passAliasCompile = runCommand(node, [
      compileMjs,
      "--lib", libPath,
      "--use", "greeting:my_hello",
      "my_hello",
      aliasKo
    ]);
    assert.equal(passAliasCompile.status, 0, passAliasCompile.stderr);

    // 4.5 CLI k.mjs without --use fails
    const unitBytes = runCommand(node, [unitParseMjs, "--parse"], { encoding: null }).stdout;
    const failRun = runCommand(node, [kMjs, "--lib", libPath, "greeting"], {
      input: unitBytes
    });
    assert.notEqual(failRun.status, 0);
    assert.match(failRun.stderr, /No definition found for 'greeting'/);

    // 4.6 CLI k.mjs with @greetingHash succeeds
    const passHashRun = runCommand(node, [kMjs, "--lib", libPath, greetingHash], {
      input: unitBytes,
      encoding: null
    });
    assert.equal(passHashRun.status, 0, passHashRun.stderr?.toString());
    const printHash = runCommand(node, [kPrintMjs], {
      input: passHashRun.stdout,
      encoding: "utf8"
    });
    assert.equal(printHash.stdout.trim(), '"welcome"');

    // 4.7 CLI k.mjs with --use greeting succeeds
    const passUseRun = runCommand(node, [kMjs, "--lib", libPath, "--use", "greeting", "greeting"], {
      input: unitBytes,
      encoding: null
    });
    assert.equal(passUseRun.status, 0, passUseRun.stderr?.toString());
    const printUse = runCommand(node, [kPrintMjs], {
      input: passUseRun.stdout,
      encoding: "utf8"
    });
    assert.equal(printUse.stdout.trim(), '"welcome"');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
console.log("    Passed: CLI isolation and --use flags verified.");

// -----------------------------------------------------------------------------
// §5. Exact Line Number Preservation (No text synthesis or line offset)
// -----------------------------------------------------------------------------
console.log("--> Test 5: Exact 1-to-1 source line numbers in diagnostics");
{
  const sourceWithComment = [
    "# --lib lib/dummy.klib --use hello world",
    "-- Comment line 2",
    "-- Comment line 3",
    "bad_definition = undefined_symbol;",
    "()"
  ].join("\n");

  try {
    compileObject(sourceWithComment, { source: "test-lines.k" });
    assert.fail("Compilation should fail on undefined_symbol");
  } catch (error) {
    // line 4 must be reported exactly, not shifted by any synthesized preamble
    assert.match(
      error.message,
      /lines 4:18\.\.\.4:34/,
      `Error line must be line 4, got: ${error.message}`
    );
  }
}
console.log("    Passed: Exact line numbers preserved without offset.");

// -----------------------------------------------------------------------------
// §6. REPL Sequential :load of Standard Libraries (No Renaming Magic)
// -----------------------------------------------------------------------------
console.log("--> Test 6: REPL sequential :load of standard libraries");
{
  const djsonState = createState();
  for (const libFile of ["core.k", "lib/generic.k", "lib/ieee.k", "lib/djson.k"]) {
    await evaluateInput(`:load ${libFile}`, djsonState);
  }

  // Verify that symbols are accessible in REPL under their exact canonical names
  assert.ok(djsonState.relAliases.reverse, "Expected 'reverse' in REPL");
  assert.ok(djsonState.relAliases.btrie_get, "Expected 'btrie_get' in REPL");
  assert.ok(djsonState.relAliases.ratio_to_float64, "Expected 'ratio_to_float64' in REPL");
  assert.ok(djsonState.relAliases.parse_json, "Expected 'parse_json' in REPL");
  assert.ok(djsonState.patternAliases.bit, "Expected 'bit[]' in REPL");
  assert.ok(djsonState.patternAliases.list, "Expected 'list[X]' in REPL");
  assert.ok(djsonState.patternAliases.btrie, "Expected 'btrie[V]' in REPL");
  assert.ok(djsonState.patternAliases.unicode, "Expected 'unicode[]' in REPL");
  assert.ok(djsonState.patternAliases.float64, "Expected 'float64[]' in REPL");
  assert.ok(djsonState.patternAliases.djson, "Expected 'djson[]' in REPL");

  const intState = createState();
  for (const libFile of ["core.k", "lib/integer.k"]) {
    await evaluateInput(`:load ${libFile}`, intState);
  }
  assert.ok(intState.relAliases.inc, "Expected 'inc' in REPL");
  assert.ok(intState.relAliases.times, "Expected 'times' in REPL");
  assert.ok(intState.relAliases.divmod, "Expected 'divmod' in REPL");
  assert.ok(intState.patternAliases.int, "Expected 'int[]' in REPL");
}
console.log("    Passed: All standard libraries load cleanly in REPL without renaming.");

// -----------------------------------------------------------------------------
// §7. --use Redefinition Warnings and Later-Definition-Wins Semantics
// -----------------------------------------------------------------------------
console.log("--> Test 7: --use redefinition warnings and later-definition-wins");
{
  function withCapturedWarnings(fn) {
    const warnings = [];
    const origWarn = console.warn;
    console.warn = (...args) => warnings.push(args.map(String).join(" "));
    try {
      const value = fn();
      return { value, warnings };
    } finally {
      console.warn = origWarn;
    }
  }

  const lib1 = loadLibrary(compileLibrary(`
    greet = {} |from_lib1;
    secret = {} |classified_lib1;
    box[] = { {} lib1_tag };
    alt[] = { {} alt_tag };
    dual = {} |dual_rel;
    dual[] = { {} dual_pat };
  `, { source: "lib1.k" }));

  const lib2 = loadLibrary(compileLibrary(`
    greet = {} |from_lib2;
    box[] = { {} lib2_tag };
  `, { source: "lib2.k" }));

  // 7.1 Local relation redefines --use relation: warn, later (local) wins
  {
    const { value: obj, warnings } = withCapturedWarnings(() =>
      compileObject(
        `greet = {} |local_override;\n{ greet local_res, ${lib1.relAlias.greet} hash_res }`,
        { libraries: [lib1], useSpecs: ["greet"] }
      )
    );
    assert.ok(
      warnings.some((w) => /WARNING/.test(w) && /Relation 'greet'/.test(w)),
      `Expected warning for redefined --use relation 'greet', got: ${JSON.stringify(warnings)}`
    );
    const out = objectToFunction(obj)(Value.product({}));
    assert.equal(out.product.local_res.tag, "local_override");
    assert.equal(out.product.hash_res.tag, "from_lib1");
  }

  // 7.2 Local pattern redefines --use pattern (both compileObject & compileLibrary): warn, local wins
  {
    const script = `
      box[] = { {} local_tag };
      outer[] = { box[] inner };
      { {} local_tag } ?box[]
    `;
    const { value: obj, warnings } = withCapturedWarnings(() =>
      compileObject(script, { libraries: [lib1], useSpecs: ["box[]"] })
    );
    assert.ok(
      warnings.some((w) => /WARNING/.test(w) && /Pattern 'box\[\]'/.test(w)),
      `Expected warning for redefined --use pattern 'box[]', got: ${JSON.stringify(warnings)}`
    );
    const out = objectToFunction(obj)(Value.product({}));
    assert.equal(out.type, "{}");

    const standaloneOuter = loadLibrary(
      compileLibrary("box[] = { {} local_tag }; outer[] = { box[] inner };", { source: "standalone-outer.k" })
    );
    const { value: libOutRaw, warnings: libWarnings } = withCapturedWarnings(() =>
      compileLibrary("box[] = { {} local_tag }; outer[] = { box[] inner };", {
        source: "redef-lib.k",
        libraries: [lib1],
        useSpecs: ["box[]"]
      })
    );
    const libOut = loadLibrary(libOutRaw);
    assert.ok(libWarnings.some((w) => /WARNING/.test(w) && /Pattern 'box\[\]'/.test(w)));
    assert.equal(libOut.patternAlias.outer, standaloneOuter.patternAlias.outer);
    assert.notEqual(libOut.patternAlias.box, lib1.patternAlias.box);
  }

  // 7.3 Two --use specs binding the same local name: warn, later --use wins
  {
    const { value: relObj, warnings: relWarn } = withCapturedWarnings(() =>
      compileObject("x", { libraries: [lib1], useSpecs: ["greet:x", "secret:x"] })
    );
    assert.ok(
      relWarn.some((w) => /WARNING/.test(w) && /Relation 'x'/.test(w)),
      `Expected warning for duplicate --use relation alias 'x', got: ${JSON.stringify(relWarn)}`
    );
    assert.equal(objectToFunction(relObj)(Value.product({})).tag, "classified_lib1");

    const { value: patObj, warnings: patWarn } = withCapturedWarnings(() =>
      compileObject("{ {} alt_tag } ?p[]", { libraries: [lib1], useSpecs: ["box[]:p", "alt[]:p"] })
    );
    assert.ok(
      patWarn.some((w) => /WARNING/.test(w) && /Pattern 'p\[\]'/.test(w)),
      `Expected warning for duplicate --use pattern alias 'p[]', got: ${JSON.stringify(patWarn)}`
    );
    assert.equal(objectToFunction(patObj)(Value.product({})).type, "{}");
  }

  // 7.4 Multiple libraries providing different definitions under the same --use name: warn, later lib wins
  {
    const { value: multiRel, warnings: mRelWarn } = withCapturedWarnings(() =>
      compileObject("greet", { libraries: [lib1, lib2], useSpecs: ["greet"] })
    );
    assert.ok(mRelWarn.some((w) => /WARNING/.test(w) && /Relation 'greet'/.test(w)));
    assert.equal(objectToFunction(multiRel)(Value.product({})).tag, "from_lib2");

    const { value: multiPat, warnings: mPatWarn } = withCapturedWarnings(() =>
      compileObject("{ {} lib2_tag } ?box[]", { libraries: [lib1, lib2], useSpecs: ["box[]"] })
    );
    assert.ok(mPatWarn.some((w) => /WARNING/.test(w) && /Pattern 'box\[\]'/.test(w)));
    assert.equal(objectToFunction(multiPat)(Value.product({})).type, "{}");
  }

  // 7.5 Chained library carrying forward the same hash under [lib1, chained] with single --use: NO warning
  {
    const chainedFromLib1 = loadLibrary(
      compileLibrary("extra = {} |extra;", { source: "chained.k", libraries: [lib1] })
    );
    const { value: chainedRes, warnings: chainWarn } = withCapturedWarnings(() =>
      compileObject("greet", { libraries: [lib1, chainedFromLib1], useSpecs: ["greet"] })
    );
    assert.equal(chainWarn.length, 0, `Same-hash chained lookup should not warn: ${chainWarn}`);
    assert.equal(objectToFunction(chainedRes)(Value.product({})).tag, "from_lib1");
  }

  // 7.6 Importing pattern `dual[]` and relation `dual` together in --use: NO false collision warning
  {
    const { value: dualObj, warnings: dualWarn } = withCapturedWarnings(() =>
      compileObject("{ dual r, { {} dual_pat } ?dual[] p }", {
        libraries: [lib1],
        useSpecs: ["dual[]", "dual"]
      })
    );
    assert.equal(dualWarn.length, 0, `Distinct pattern/rel namespaces must not warn: ${dualWarn}`);
    const out = objectToFunction(dualObj)(Value.product({}));
    assert.equal(out.product.r.tag, "dual_rel");
    assert.equal(out.product.p.type, "{}");
  }

  // 7.7 CLI k.mjs & compile.mjs: --use + local redefinition emits WARNING on stderr while preserving binary stdout
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-test-use-warn-"));
  try {
    const libPath = path.join(tmpDir, "lib1.klib");
    fs.writeFileSync(path.join(tmpDir, "lib1.k"), "greet = {} |from_lib1;", "utf8");
    const buildLib = runCommand(node, [compileMjs, path.join(tmpDir, "lib1.k"), libPath]);
    assert.equal(buildLib.status, 0, buildLib.stderr);

    const unitBytes = runCommand(node, [unitParseMjs, "--parse"], { encoding: null }).stdout;
    const cliRun = runCommand(node, [
      kMjs, "--lib", libPath, "--use", "greet",
      "greet = {} |cli_override; greet"
    ], { input: unitBytes, encoding: null });
    assert.equal(cliRun.status, 0, cliRun.stderr?.toString());
    assert.match(
      cliRun.stderr.toString("utf8"),
      /WARNING:.*Relation 'greet' declared by --use/,
      `Expected CLI stderr warning, got: ${cliRun.stderr.toString("utf8")}`
    );
    const printed = runCommand(node, [kPrintMjs], { input: cliRun.stdout, encoding: "utf8" });
    assert.equal(printed.stdout.trim(), '"cli_override"');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
console.log("    Passed: --use redefinition warnings and later-definition-wins verified.");

// -----------------------------------------------------------------------------
// §8. Explicit Check That Local / Un-imported Names Do Not Leak
// -----------------------------------------------------------------------------
console.log("--> Test 8: Explicit non-leakage of local/un-imported names");
{
  const libA = loadLibrary(compileLibrary(`
    priv_rel = {} |from_libA_priv;
    priv_pat[] = { {} libA_tag };
    pub_rel = priv_rel;
    pub_pat[] = { priv_pat[] inner };
  `, { source: "libA.k" }));

  // 8.1 Importing pub_rel / pub_pat[] via --use must NOT leak transitive priv_rel / priv_pat[]
  assert.throws(
    () => compileObject("priv_rel", { libraries: [libA], useSpecs: ["pub_rel", "pub_pat[]"] }),
    /No definition found for 'priv_rel'/,
    "Transitive helper relation 'priv_rel' must not leak when importing 'pub_rel'"
  );
  assert.throws(
    () => compileObject("{{} libA_tag} ?priv_pat[]", {
      libraries: [libA],
      useSpecs: ["pub_rel", "pub_pat[]"]
    }),
    /Unknown pattern template 'priv_pat\[\]'/,
    "Transitive helper pattern 'priv_pat[]' must not leak when importing 'pub_pat[]'"
  );

  // 8.2 Redefining local names in libB must NOT leak into libA's pub_rel / pub_pat[], nor leak out to libC
  const libBWarnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => libBWarnings.push(args.map(String).join(" "));
  let libB;
  try {
    libB = loadLibrary(compileLibrary(`
      priv_rel = {} |from_libB_local;
      priv_pat[] = { {} libB_tag };
      local_helper = priv_rel;
      local_wrap[] = { priv_pat[] inner };
      exposed_from_a = pub_rel;
      exposed_pat_from_a[] = { pub_pat[] wrapped };
    `, {
      source: "libB.k",
      libraries: [libA],
      useSpecs: ["pub_rel", "pub_pat[]"]
    }));
  } finally {
    console.warn = origWarn;
  }
  assert.equal(
    libBWarnings.length,
    0,
    `Redefining un-imported names must not emit warnings: ${libBWarnings}`
  );

  // Compiling downstream against libB with aliased --use: only explicit aliases enter scope
  const downstream = compileObject(
    "{ entry_rel r, { { {} libA_tag } inner } ?entry_pat[] p }",
    {
      libraries: [libB],
      useSpecs: ["exposed_from_a:entry_rel", "pub_pat[]:entry_pat[]"]
    }
  );
  const res = objectToFunction(downstream)(Value.product({}));
  assert.equal(res.product.r.tag, "from_libA_priv");
  assert.equal(res.product.p.type, "{}");

  // Neither libA's priv/pub names nor libB's local/aliased-away names may leak into downstream scope
  for (const hiddenRel of ["priv_rel", "pub_rel", "local_helper", "exposed_from_a"]) {
    assert.throws(
      () => compileObject(hiddenRel, {
        libraries: [libB],
        useSpecs: ["exposed_from_a:entry_rel", "pub_pat[]:entry_pat[]"]
      }),
      new RegExp(`No definition found for '${hiddenRel}'`),
      `Un-imported local/library relation '${hiddenRel}' must not leak`
    );
  }
  for (const hiddenPat of ["priv_pat", "pub_pat", "local_wrap", "exposed_pat_from_a"]) {
    assert.throws(
      () => compileObject(`x = ?${hiddenPat}[]; ()`, {
        libraries: [libB],
        useSpecs: ["exposed_from_a:entry_rel", "pub_pat[]:entry_pat[]"]
      }),
      new RegExp(`Unknown pattern template '${hiddenPat}\\[\\]'`),
      `Un-imported local/library pattern '${hiddenPat}[]' must not leak`
    );
  }

  // 8.3 Direct pattern resolution APIs must also enforce hash-only library imports
  const parsedProbe = parse("probe[] = { priv_pat[] x }; ()");
  assert.throws(
    () => resolvePatternCanonicalInfo("probe", parsedProbe.defs.patterns.probe, { libraries: [libA, libB] }),
    /Unknown pattern template 'priv_pat\[\]'/,
    "resolvePatternCanonicalInfo must not leak friendly names from libraries"
  );
  assert.throws(
    () => validatePatternDefinitions(parsedProbe.defs.patterns, { libraries: [libA, libB] }),
    /Unknown pattern template 'priv_pat\[\]'/,
    "validatePatternDefinitions must not leak friendly names from libraries"
  );
}
console.log("    Passed: Local and un-imported names remain strictly isolated without leakage.");

console.log("==> All Library Isolation & Scope Binding Tests Passed Successfully!");
