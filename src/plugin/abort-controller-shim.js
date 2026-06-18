// Replaces the `abort-controller` npm package with Node's built-in
// AbortController/AbortSignal. Wired via webpack `resolve.alias`.
// Reason: webpack + terser mangle the polyfill's `module.exports = X;
// module.exports.AbortController = X` shape into `o.AbortController is
// not a constructor` at runtime. Node 20 has these globals natively.
"use strict";
module.exports = {
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  default: globalThis.AbortController,
};
