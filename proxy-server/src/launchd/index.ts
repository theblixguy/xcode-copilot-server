export { activateSocket } from "./socket.js";
export type { NativeActivateFn, ActivateSocketOptions } from "./socket.js";

export {
  installAgent,
  uninstallAgent,
  generatePlist,
  parsePlistArgs,
  defaultPlistPath,
  defaultLogPaths,
  AGENT_LABEL,
} from "./agent.js";

export type {
  ExecFn,
  PlistOptions,
  ParsedPlistArgs,
  InstallAgentOptions,
  UninstallAgentOptions,
} from "./agent.js";
