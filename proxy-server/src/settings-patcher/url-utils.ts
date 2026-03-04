const LOCALHOST_PORT_RE = /localhost:(\d+)/;

export function extractLocalhostPort(url: string): number | undefined {
  const match = LOCALHOST_PORT_RE.exec(url);
  return match?.[1] ? parseInt(match[1], 10) : undefined;
}
