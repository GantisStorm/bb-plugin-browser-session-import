/// <reference types="vitest/jsdom" />
if (typeof window !== "undefined" && typeof jsdom !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: jsdom.window.localStorage,
  });
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: jsdom.window.sessionStorage,
  });
}
