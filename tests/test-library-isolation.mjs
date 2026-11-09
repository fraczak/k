import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import k from "../index.mjs";
import { Value } from "../Value.mjs";
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
  `;
  const library = loadLibrary(compileLibrary(libSource, { source: "lib-foo.k" }));
  const fooHash = library.relAlias.foo;

  // Local file defines its own 'foo' without --use foo.
  // The local 'foo' evaluates to local_foo.
  // The library foo is only accessible via @fooHash.
  const source = `
    foo = {} |local_foo;
    call_local = foo;
    call_lib = ${fooHash};
    { call_local local, call_lib lib }
  `;
  const compiled = compileObject(source, { libraries: [library] });
  const result = objectToFunction(compiled)(Value.product({}));
  assert.equal(result.product.local.tag, "local_foo");
  assert.equal(result.product.lib.tag, "library_foo");
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
  const state = createState();
  const libSequence = [
    "lib/bit.k",
    "lib/bits.k",
    "lib/list.k",
    "lib/btrie.k",
    "lib/string.k",
    "lib/ieee.k",
    "lib/djson.k",
    "lib/arithmetics.k"
  ];

  for (const libFile of libSequence) {
    await evaluateInput(`:load ${libFile}`, state);
  }

  // Verify that symbols are accessible in REPL under their exact canonical names
  assert.ok(state.relAliases.inc, "Expected 'inc' in REPL");
  assert.ok(state.relAliases.inc_bits, "Expected 'inc_bits' in REPL");
  assert.ok(state.relAliases.list_size, "Expected 'list_size' in REPL");
  assert.ok(state.relAliases.reverse, "Expected 'reverse' in REPL");
  assert.ok(state.patternAliases.bit, "Expected 'bit[]' in REPL");
  assert.ok(state.patternAliases.list, "Expected 'list[T]' in REPL");
  assert.ok(state.patternAliases.btrie, "Expected 'btrie[V]' in REPL");
  assert.ok(state.patternAliases.unicode, "Expected 'unicode[]' in REPL");
}
console.log("    Passed: All standard libraries load cleanly in REPL without renaming.");

console.log("==> All Library Isolation & Scope Binding Tests Passed Successfully!");
