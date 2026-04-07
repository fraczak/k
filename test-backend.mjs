import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { compileFrontend } from "./k_compiler/frontend.mjs";
import { compileIR } from "./k_compiler/ir.mjs";
import { compileToC } from "./k_compiler/backend_c.mjs";
import { compileToLLVM } from "./k_compiler/backend_llvm.mjs";

const script = fs.readFileSync("./Examples/nat.k", "utf8");
const frontend = compileFrontend(script);
const ir = compileIR(frontend);

const cSource = compileToC(ir);
assert.match(cSource, /KOpt k_entry\(KValue input\)/);
assert.match(cSource, /krt_project_field/);
assert.match(cSource, /krt_make_product/);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "k-backend-"));
const cFile = path.join(tempDir, "nat_backend.c");
fs.writeFileSync(cFile, cSource);
execFileSync("clang", ["-fsyntax-only", "-I", path.resolve("./k_compiler"), cFile], { stdio: "pipe" });

const llvmSource = compileToLLVM(ir);
assert.match(llvmSource, /define %KOpt @k_entry/);
assert.match(llvmSource, /declare %KOpt @krt_project_field/);
assert.match(llvmSource, /define %KOpt @kfn_/);

console.log("backend emitters ok");
