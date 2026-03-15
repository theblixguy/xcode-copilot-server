import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

export type ExecFn = (cmd: string, args: string[]) => Promise<string>;

export async function defaultExec(
  cmd: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args);
  return stdout;
}
