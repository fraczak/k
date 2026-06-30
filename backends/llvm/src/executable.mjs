import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isProduct, isVariant } from "@fraczak/k/Value.mjs";
import { exportPatternGraph } from "@fraczak/k/codecs/runtime/codec.mjs";
import { patternToPropertyList } from "@fraczak/k/codecs/runtime/pattern-json.mjs";
import { compileObjectToLLVM } from "./llvm.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function relationForObject(object, relationName = object.main) {
  if (!relationName) throw new Error("A relation name is required");
  if (object.rels?.[relationName]) return object.rels[relationName];
  const alias = object.relAlias?.[relationName];
  if (alias && object.rels?.[alias]) return object.rels[alias];
  throw new Error(`Relation '${relationName}' not found`);
}

export function inputPatternForObjectValue(object, value, relationName = object.main) {
  if (value.pattern) return value.pattern;
  return inputPatternForObjectRelation(object, relationName);
}

export function inputPatternForObjectRelation(object, relationName = object.main) {
  const rel = relationForObject(object, relationName);
  const inputPatternId = rel.typePatternGraph.find(rel.def.patterns[0]);
  return patternToPropertyList(exportPatternGraph(rel.typePatternGraph, inputPatternId));
}

function cString(text) {
  return JSON.stringify(String(text));
}

function cByteArray(text) {
  const bytes = [...Buffer.from(String(text), "utf8")];
  return bytes.length === 0 ? "{0}" : `{${bytes.map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}}`;
}

const patternKindConstants = {
  "any": "KP_ANY",
  "open-product": "KP_OPEN_PRODUCT",
  "open-union": "KP_OPEN_UNION",
  "closed-product": "KP_CLOSED_PRODUCT",
  "closed-union": "KP_CLOSED_UNION"
};

function emitPattern(name, pattern) {
  if (!Array.isArray(pattern)) throw new Error(`${name} pattern must be a property-list array`);
  const lines = [];
  for (let nodeIndex = 0; nodeIndex < pattern.length; nodeIndex++) {
    const node = pattern[nodeIndex];
    if (!Array.isArray(node) || node.length !== 2) {
      throw new Error(`${name} pattern node ${nodeIndex} is invalid`);
    }
    const [, edges] = node;
    if (!Array.isArray(edges)) throw new Error(`${name} pattern node ${nodeIndex} edges are invalid`);
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      if (!Array.isArray(edge) || edge.length !== 2) {
        throw new Error(`${name} pattern node ${nodeIndex} edge is invalid`);
      }
      const [label] = edge;
      lines.push(`static const unsigned char ${name}_label_${nodeIndex}_${edgeIndex}[] = ${cByteArray(label)};`);
    }
    if (edges.length === 0) continue;
    lines.push(`static k_pattern_edge ${name}_edges_${nodeIndex}[] = {`);
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex++) {
      const edge = edges[edgeIndex];
      const [label, target] = edge;
      const labelLength = Buffer.byteLength(String(label), "utf8");
      const labelRef = `${name}_label_${nodeIndex}_${edgeIndex}`;
      lines.push(`  {(const char *)${labelRef}, ${labelLength}, ${Number(target)}}${edgeIndex === edges.length - 1 ? "" : ","}`);
    }
    lines.push("};");
  }
  lines.push(`static k_pattern_node ${name}_nodes[] = {`);
  pattern.forEach(([kind, edges], index) => {
    const constant = patternKindConstants[kind];
    if (constant == null) throw new Error(`${name} pattern node ${index} has unsupported kind '${kind}'`);
    const edgeRef = edges.length === 0 ? "NULL" : `${name}_edges_${index}`;
    lines.push(`  {${constant}, ${edges.length}, ${edgeRef}}${index === pattern.length - 1 ? "" : ","}`);
  });
  lines.push("};");
  lines.push(`static k_pattern ${name} = {${pattern.length}, ${name}_nodes};`);
  return lines.join("\n");
}

function emitValueBuilder(value, ctx) {
  if (isProduct(value)) {
    const name = `v${ctx.next++}`;
    const fields = Object.entries(value.product);
    ctx.lines.push(`  k_value *${name} = k_product(rt, ${fields.length});`);
    for (const [label, child] of fields) {
      const childName = emitValueBuilder(child, ctx);
      ctx.lines.push(`  k_product_set(${name}, ${cString(label)}, ${childName});`);
    }
    return name;
  }

  if (isVariant(value)) {
    const childName = emitValueBuilder(value.value, ctx);
    const name = `v${ctx.next++}`;
    ctx.lines.push(`  k_value *${name} = k_variant(rt, ${cString(value.tag)}, ${childName});`);
    return name;
  }

  throw new Error(`Unsupported k value: ${JSON.stringify(value)}`);
}

function builderFunction(name, value) {
  const ctx = { next: 0, lines: [] };
  const result = emitValueBuilder(value, ctx);
  return [
    `static k_value *${name}(k_rt *rt) {`,
    ...ctx.lines,
    `  return ${result};`,
    "}",
    ""
  ].join("\n");
}

export function driverSource({ input, expected = null }) {
  const expectedBuilder = expected == null ? "" : builderFunction("build_expected", expected);
  const expectedCheck = expected == null
    ? [
        "  k_print_json(stdout, result.value);",
        "  fputc('\\n', stdout);"
      ]
    : [
        "  k_value *expected = build_expected(rt);",
        "  if (!k_equal(result.value, expected)) return 3;"
      ];

  return [
    '#include "krt.h"',
    "#include <stdio.h>",
    "",
    "extern k_result k_main(k_rt *rt, k_value *input);",
    "",
    builderFunction("build_input", input),
    expectedBuilder,
    "int main(void) {",
    "  k_rt *rt = k_rt_new();",
    "  if (rt == 0) return 1;",
    "  k_value *input = build_input(rt);",
    "  k_result result = k_main(rt, input);",
    "  if (result.status != K_STATUS_OK) return 2;",
    ...expectedCheck,
    "  k_rt_free(rt);",
    "  return 0;",
    "}",
    ""
  ].join("\n");
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options
  });
  if (result.error && result.status !== 0) throw result.error;
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status}${detail ? `\n${detail}` : ""}`);
  }
  return result;
}

export function compileAndRunLLVM(llvm, { input, expected = null, tmpPrefix = "k-llvm-run-" }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), tmpPrefix));
  try {
    const llPath = path.join(tmpDir, "program.ll");
    const driverPath = path.join(tmpDir, "driver.c");
    const exePath = path.join(tmpDir, "program");
    fs.writeFileSync(llPath, llvm);
    fs.writeFileSync(driverPath, driverSource({ input, expected }));
    runCommand("clang", [
      "-O3",
      "-Wno-override-module",
      "-Iruntime",
      "runtime/krt.c",
      driverPath,
      llPath,
      "-o",
      exePath
    ]);
    return runCommand(exePath, []);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function stdioDriverSource({ inputPattern = null, outputPattern = null } = {}) {
  if (inputPattern == null || outputPattern == null) {
    return [
      '#include "krt.h"',
      "",
      "extern k_result k_main(k_rt *rt, k_value *input);",
      "",
      "int main(void) {",
      "  k_rt *rt = k_rt_new();",
      "  if (rt == 0) return 1;",
      "  k_value *input = k_read_wire(stdin, rt);",
      "  if (input == 0) return 2;",
      "  k_result result = k_main(rt, input);",
      "  if (result.status != K_STATUS_OK) return 3;",
      "  if (!k_write_wire(stdout, result.value)) return 4;",
      "  k_rt_free(rt);",
      "  return 0;",
      "}",
      ""
    ].join("\n");
  }

  return [
    '#include "krt.h"',
    "#include <stdint.h>",
    "#include <stdio.h>",
    "#include <stdlib.h>",
    "#include <string.h>",
    "#include <time.h>",
    "",
    emitPattern("compiled_input_pattern", inputPattern),
    "",
    emitPattern("compiled_output_pattern", outputPattern),
    "",
    "extern k_result k_main(k_rt *rt, k_value *input);",
    "",
    "static int read_exact(FILE *in, unsigned char *buffer, size_t length) {",
    "  size_t offset = 0;",
    "  while (offset < length) {",
    "    size_t n = fread(buffer + offset, 1, length - offset, in);",
    "    if (n == 0) {",
    "      if (ferror(in)) return -1;",
    "      return offset == 0 ? 0 : -1;",
    "    }",
    "    offset += n;",
    "  }",
    "  return 1;",
    "}",
    "",
    "static int write_frame(k_wire_prefix *prefix, k_pattern *pattern, k_value *value) {",
    "  size_t length = 0;",
    "  unsigned char *payload = k_encode_wire_as_with_prefix(prefix, pattern, value, &length);",
    "  if (payload == NULL || length > UINT32_MAX) {",
    "    free(payload);",
    "    return 0;",
    "  }",
    "  unsigned char header[4] = {",
    "    (unsigned char)((length >> 24) & 0xff),",
    "    (unsigned char)((length >> 16) & 0xff),",
    "    (unsigned char)((length >> 8) & 0xff),",
    "    (unsigned char)(length & 0xff)",
    "  };",
    "  int ok = fwrite(header, 1, 4, stdout) == 4 && fwrite(payload, 1, length, stdout) == length && fflush(stdout) == 0;",
    "  free(payload);",
    "  return ok;",
    "}",
    "",
    "static int run_value(k_rt *rt, k_wire_prefix *output_prefix, k_value *input_value) {",
    "  k_result result = k_main(rt, input_value);",
    "  if (result.status != K_STATUS_OK) return 3;",
    "  return write_frame(output_prefix, &compiled_output_pattern, result.value) ? 0 : 4;",
    "}",
    "",
    "static int run_payload(k_rt *rt, k_wire_prefix *input_prefix, k_wire_prefix *output_prefix, const unsigned char *payload, size_t length) {",
    "  k_value *fast_input = k_decode_wire_value_with_prefix(payload, length, input_prefix, &compiled_input_pattern, rt);",
    "  if (fast_input != 0) return run_value(rt, output_prefix, fast_input);",
    "  k_wire_input input = k_decode_wire_envelope(payload, length, rt);",
    "  if (input.value == 0 || input.pattern == 0) {",
    "    k_wire_input_free(input);",
    "    return 2;",
    "  }",
    "  if (!k_pattern_equal(input.pattern, &compiled_input_pattern)) {",
    "    k_wire_input_free(input);",
    "    return 5;",
    "  }",
    "  int status = run_value(rt, output_prefix, input.value);",
    "  k_wire_input_free(input);",
    "  return status;",
    "}",
    "",
    "static int run_server(void) {",
    "  k_rt *rt = k_rt_new();",
    "  if (rt == 0) return 1;",
    "  k_wire_prefix input_prefix = k_wire_prefix_for_pattern(&compiled_input_pattern);",
    "  k_wire_prefix output_prefix = k_wire_prefix_for_pattern(&compiled_output_pattern);",
    "  if (!input_prefix.ok || !output_prefix.ok) {",
    "    k_wire_prefix_free(input_prefix);",
    "    k_wire_prefix_free(output_prefix);",
    "    k_rt_free(rt);",
    "    return 8;",
    "  }",
    "  for (;;) {",
    "    unsigned char header[4];",
    "    int header_status = read_exact(stdin, header, 4);",
    "    if (header_status == 0) {",
    "      k_wire_prefix_free(input_prefix);",
    "      k_wire_prefix_free(output_prefix);",
    "      k_rt_free(rt);",
    "      return 0;",
    "    }",
    "    if (header_status < 0) {",
    "      k_wire_prefix_free(input_prefix);",
    "      k_wire_prefix_free(output_prefix);",
    "      k_rt_free(rt);",
    "      return 6;",
    "    }",
    "    uint32_t length = ((uint32_t)header[0] << 24) | ((uint32_t)header[1] << 16) | ((uint32_t)header[2] << 8) | (uint32_t)header[3];",
    "    unsigned char *payload = malloc(length == 0 ? 1 : length);",
    "    if (payload == NULL) {",
    "      k_wire_prefix_free(input_prefix);",
    "      k_wire_prefix_free(output_prefix);",
    "      k_rt_free(rt);",
    "      return 7;",
    "    }",
    "    int payload_status = read_exact(stdin, payload, length);",
    "    if (payload_status != 1) {",
    "      free(payload);",
    "      k_wire_prefix_free(input_prefix);",
    "      k_wire_prefix_free(output_prefix);",
    "      k_rt_free(rt);",
    "      return 6;",
    "    }",
    "    int status = run_payload(rt, &input_prefix, &output_prefix, payload, length);",
    "    free(payload);",
    "    k_rt_reset(rt);",
    "    if (status != 0) {",
    "      k_wire_prefix_free(input_prefix);",
    "      k_wire_prefix_free(output_prefix);",
    "      k_rt_free(rt);",
    "      return status;",
    "    }",
    "  }",
    "}",
    "",
    "static uint64_t monotonic_ns(void) {",
    "  struct timespec ts;",
    "  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) return 0;",
    "  return ((uint64_t)ts.tv_sec * 1000000000ull) + (uint64_t)ts.tv_nsec;",
    "}",
    "",
    "static int parse_size_arg(const char *text, size_t *out) {",
    "  if (text == NULL || *text == 0) return 0;",
    "  size_t value = 0;",
    "  for (const char *p = text; *p != 0; p++) {",
    "    if (*p < '0' || *p > '9') return 0;",
    "    size_t digit = (size_t)(*p - '0');",
    "    if (value > (((size_t)-1) - digit) / 10) return 0;",
    "    value = value * 10 + digit;",
    "  }",
    "  if (value == 0) return 0;",
    "  *out = value;",
    "  return 1;",
    "}",
    "",
    "static int run_bench_main(const char *count_text) {",
    "  size_t count = 0;",
    "  if (!parse_size_arg(count_text, &count)) return 9;",
    "  k_rt *input_rt = k_rt_new();",
    "  k_rt *run_rt = k_rt_new();",
    "  if (input_rt == 0 || run_rt == 0) return 1;",
    "  k_wire_input input = k_read_wire_envelope(stdin, input_rt);",
    "  if (input.value == 0 || input.pattern == 0) {",
    "    k_wire_input_free(input);",
    "    k_rt_free(run_rt);",
    "    k_rt_free(input_rt);",
    "    return 2;",
    "  }",
    "  if (!k_pattern_equal(input.pattern, &compiled_input_pattern)) {",
    "    k_wire_input_free(input);",
    "    k_rt_free(run_rt);",
    "    k_rt_free(input_rt);",
    "    return 5;",
    "  }",
    "  uint64_t started_at = monotonic_ns();",
    "  for (size_t i = 0; i < count; i++) {",
    "    k_result result = k_main(run_rt, input.value);",
    "    if (result.status != K_STATUS_OK) {",
    "      k_wire_input_free(input);",
    "      k_rt_free(run_rt);",
    "      k_rt_free(input_rt);",
    "      return 3;",
    "    }",
    "    k_rt_reset(run_rt);",
    "  }",
    "  uint64_t ended_at = monotonic_ns();",
    "  uint64_t elapsed = ended_at >= started_at ? ended_at - started_at : 0;",
    "  fprintf(stderr, \"K_LLVM_BENCH_MAIN calls=%zu total_ns=%llu per_call_ns=%.2f\\n\", count, (unsigned long long)elapsed, count == 0 ? 0.0 : (double)elapsed / (double)count);",
    "  k_wire_input_free(input);",
    "  k_rt_free(run_rt);",
    "  k_rt_free(input_rt);",
    "  return 0;",
    "}",
    "",
    "int main(int argc, char **argv) {",
    "  if (argc == 2 && strcmp(argv[1], \"--server\") == 0) return run_server();",
    "  if (argc == 3 && strcmp(argv[1], \"--bench-main\") == 0) return run_bench_main(argv[2]);",
    "  k_rt *rt = k_rt_new();",
    "  if (rt == 0) return 1;",
    "  k_wire_prefix output_prefix = k_wire_prefix_for_pattern(&compiled_output_pattern);",
    "  k_wire_input input = k_read_wire_envelope(stdin, rt);",
    "  if (input.value == 0 || input.pattern == 0) {",
    "    k_wire_prefix_free(output_prefix);",
    "    k_rt_free(rt);",
    "    return 2;",
    "  }",
    "  if (!k_pattern_equal(input.pattern, &compiled_input_pattern)) {",
    "    k_wire_input_free(input);",
    "    k_wire_prefix_free(output_prefix);",
    "    k_rt_free(rt);",
    "    return 5;",
    "  }",
    "  k_result result = k_main(rt, input.value);",
    "  if (result.status != K_STATUS_OK) {",
    "    k_wire_input_free(input);",
    "    k_wire_prefix_free(output_prefix);",
    "    k_rt_free(rt);",
    "    return 3;",
    "  }",
    "  size_t output_length = 0;",
    "  unsigned char *output_payload = k_encode_wire_as_with_prefix(&output_prefix, &compiled_output_pattern, result.value, &output_length);",
    "  int ok = output_payload != NULL && fwrite(output_payload, 1, output_length, stdout) == output_length;",
    "  free(output_payload);",
    "  k_wire_input_free(input);",
    "  k_wire_prefix_free(output_prefix);",
    "  if (!ok) return 4;",
    "  k_rt_free(rt);",
    "  return 0;",
    "}",
    ""
  ].join("\n");
}

export function compileLLVMToExecutable(llvm, outputPath, { driver = stdioDriverSource(), tmpPrefix = "k-llvm-build-", clangOpt = "-O3" } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), tmpPrefix));
  try {
    const llPath = path.join(tmpDir, "program.ll");
    const driverPath = path.join(tmpDir, "driver.c");
    fs.writeFileSync(llPath, llvm);
    fs.writeFileSync(driverPath, driver);
    runCommand("clang", [
      clangOpt,
      "-Wno-override-module",
      "-Iruntime",
      "runtime/krt.c",
      driverPath,
      llPath,
      "-o",
      outputPath
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export function compileObjectToExecutable(object, outputPath, { relation = object.main, inputPattern = null, runtimeMode = "fast", clangOpt = "-O3" } = {}) {
  const { inputPattern: compiledInputPattern, outputPattern, llvm } = compileObjectToLLVM(object, {
    relation,
    inputPattern: inputPattern || inputPatternForObjectRelation(object, relation),
    runtimeMode
  });
  compileLLVMToExecutable(llvm, outputPath, {
    driver: stdioDriverSource({
      inputPattern: compiledInputPattern,
      outputPattern
    }),
    clangOpt
  });
}

export function compileObjectAndRun(object, { relation = object.main, input, expected = null, inputPattern = null }) {
  const { llvm } = compileObjectToLLVM(object, {
    relation,
    inputPattern: inputPattern || inputPatternForObjectValue(object, input, relation)
  });
  return compileAndRunLLVM(llvm, { input, expected });
}
