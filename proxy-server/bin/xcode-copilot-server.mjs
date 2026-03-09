#!/usr/bin/env node

// Register the ESM resolution hook before loading the main entry point.
// This must happen via dynamic import() so the hook is active when
// @github/copilot-sdk's static imports are resolved.
import "../dist/fix-jsonrpc-import.js";
await import("../dist/index.js");
