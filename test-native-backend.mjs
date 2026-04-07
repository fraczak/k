import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { compileFrontend } from "./k_compiler/frontend.mjs";
import { compileIR } from "./k_compiler/ir.mjs";
import { compileToC } from "./k_compiler/backend_c.mjs";

const script = fs.readFileSync("./Examples/nat.k", "utf8");
const frontend = compileFrontend(script);
const ir = compileIR(frontend);
const cSource = compileToC(ir);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-native-"));
const generatedPath = path.join(tempDir, "generated.c");
const driverPath = path.join(tempDir, "driver.c");
const binaryPath = path.join(tempDir, "native-test");

fs.writeFileSync(generatedPath, cSource);
fs.writeFileSync(driverPath, `
#include <stdio.h>
#include "runtime.h"

KOpt k_entry(KValue input);

int main(void) {
  KValue unit = krt_new_product("@NiDZqYggx3VZ6b8quBZKTfkgJztWctkesuX4CrhTxM5c", 0, NULL, NULL);
  KValue zero = krt_new_variant("@w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF", "zero", unit);
  KValue succ = krt_new_variant("@w8iSHeQQE738vEmWNGja3FQWk3XuExQKZ2pbm8ApEdkF", "succ", zero);

  KOpt zero_result = k_entry(zero);
  KOpt succ_result = k_entry(succ);

  printf("zero:%d:", zero_result.ok);
  if (zero_result.ok) {
    krt_print_value(zero_result.value);
  } else {
    printf("undefined");
  }
  printf("\\n");

  printf("succ:%d:", succ_result.ok);
  if (succ_result.ok) {
    krt_print_value(succ_result.value);
  } else {
    printf("undefined");
  }
  printf("\\n");

  return 0;
}
`);

execFileSync("clang", [
  "-std=c11",
  "-I",
  path.resolve("./k_compiler"),
  path.resolve("./k_compiler/runtime.c"),
  generatedPath,
  driverPath,
  "-o",
  binaryPath,
], { stdio: "pipe" });

const output = execFileSync(binaryPath, { encoding: "utf8" });
assert.match(output, /zero:1:zero\(\{\}\)/);
assert.match(output, /succ:0:undefined/);

console.log("native backend ok");
