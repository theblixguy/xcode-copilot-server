/**
 * Strips fenced code blocks whose filename header matches any of the given
 * patterns (case-insensitive).  A fenced block looks like:
 *
 *   ```swift:MockHelper.swift
 *   class MockHelper {}
 *   ```
 *
 * If the filename portion ("MockHelper.swift") contains any pattern, the entire
 * block (including the surrounding newlines) is removed.
 */
export function filterExcludedFiles(s: string, patterns: string[]): string {
  if (patterns.length === 0) return s;

  const fenceRe = /```[^\n]*:[^\n]+\n[\s\S]*?```\n?/g;

  return s.replace(fenceRe, (block) => {
    const headerEnd = block.indexOf("\n");
    const header = block.slice(0, headerEnd);
    const colonIdx = header.indexOf(":");
    if (colonIdx < 0) return block;
    const filename = header.slice(colonIdx + 1);

    for (const pattern of patterns) {
      if (filename.toLowerCase().includes(pattern.toLowerCase())) {
        return "";
      }
    }
    return block;
  });
}
