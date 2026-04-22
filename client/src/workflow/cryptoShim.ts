/**
 * Thin shim for generating random IDs in the browser.
 * Avoids importing Node's crypto module.
 */
export default {
  randomId(): string {
    return globalThis.crypto.randomUUID().slice(0, 8);
  },
};
