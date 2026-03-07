/**
 * Node.js module resolution hook that fixes a missing `.js` extension in
 * @github/copilot-sdk's import of vscode-jsonrpc/node.
 *
 * See https://github.com/github/copilot-sdk/issues/707
 */
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(`
      export function resolve(specifier, context, nextResolve) {
        if (specifier === "vscode-jsonrpc/node") {
          return nextResolve("vscode-jsonrpc/node.js", context);
        }
        return nextResolve(specifier, context);
      }
    `),
  import.meta.url,
);
