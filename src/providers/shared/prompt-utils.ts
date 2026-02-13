function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Xcode's search results can include full file contents for every match, so
// some files end up being thousands of lines and add nothing useful. We strip
// fenced code blocks whose header matches the excluded patterns (Xcode formats
// them as ```swift:/path/to/File.swift).
export function filterExcludedFiles(s: string, patterns: string[]): string {
  if (patterns.length === 0) return s;

  const joined = patterns.map(escapeRegex).join("|");
  const re = new RegExp(
    "```\\w*:[^\\n]*(?:" + joined + ")[^\\n]*\\n.*?\\n```\\n?",
    "gis",
  );
  return s.replace(re, "");
}
