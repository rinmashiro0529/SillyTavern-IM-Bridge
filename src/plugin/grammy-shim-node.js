// Replaces grammy/out/shim.node.js to fix
// `o.AbortController is not a constructor` after webpack+terser bundling.
//
// grammy's original shim uses Object.defineProperty(exports, "AbortController", { get })
// which terser eliminates because the consumer accesses it dynamically as
// `shim.AbortController` and the static analyzer can't see the use. After
// minification the shim module body collapses to nothing and `shim.AbortController`
// is undefined at runtime. Plain `module.exports = { ... }` survives terser intact.
//
// Wired via webpack `resolve.alias`. Node 20+ provides AbortController/AbortSignal
// as globals; node-fetch is preserved so grammy's `agent: keep-alive` config keeps
// working.
"use strict";
const nodeFetch = require("node-fetch");
module.exports = {
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  fetch: nodeFetch.default || nodeFetch,
};
