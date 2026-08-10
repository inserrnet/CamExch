(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CamFramePublishPolicy = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function ownerFor(state = {}) {
    return state.sourceKind === "video" && state.playing ? "decoded" : "pacer";
  }

  function accepts(owner, state = {}) {
    return owner === ownerFor(state);
  }

  return { ownerFor, accepts };
}));
