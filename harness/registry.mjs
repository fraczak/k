import { NativeAdapter } from "./adapters/native.mjs";
import { KVMAdapter } from "./adapters/kvm.mjs";
import { WasmAdapter } from "./adapters/wasm.mjs";
import { ARM64Adapter } from "./adapters/arm64.mjs";
import { LLVMAdapter } from "./adapters/llvm.mjs";

export function createRegistry(config = {}) {
  const adapters = new Map();

  function register(id, factory) {
    adapters.set(id, factory);
  }

  register("native-aware", () => new NativeAdapter("aware", config.state));
  register("native-free", () => new NativeAdapter("free", config.state));
  register("kvm", () => new KVMAdapter(config.state));
  register("wasm", () => new WasmAdapter(config.wasm || {}));
  register("wasm-in-process", () => new WasmAdapter({ id: "wasm-in-process", mode: "in-process", ...(config.wasm || {}) }));
  register("arm64", () => new ARM64Adapter(config.arm64 || {}));
  register("llvm", () => new LLVMAdapter(config.llvm || {}));

  return {
    getBackend(id) {
      const factory = adapters.get(id);
      if (!factory) throw new Error(`Unknown backend ID: '${id}'`);
      return factory();
    },

    listBackendIds() {
      return [...adapters.keys()];
    },

    getAvailableBackends() {
      const list = [];
      for (const [id, factory] of adapters.entries()) {
        const backend = factory();
        if (backend.isAvailable()) {
          list.push(backend);
        }
      }
      return list;
    }
  };
}
