import type { ModelInfo } from "@github/copilot-sdk";
import type { Logger } from "../logger.js";

function normalize(id: string): string {
  return id.replace(/-\d{8}$/, "").replace(/\./g, "-");
}

// We need to group models by family for fallback matching, so we grab the
// prefix before the first digit (e.g. "claude-sonnet-4-5" → "claude-sonnet-").
// This works for Claude naming but would lump all GPT models into "gpt-"
// so it'll need reworking once we support non-Claude model families here
// e.g. if we add Codex support.
function extractFamily(id: string): string {
  const match = id.match(/^(.*?-)\d/);
  return match?.[1] ?? id;
}

export function resolveModel(
  requestedModel: string,
  availableModels: ModelInfo[],
  logger?: Logger,
): string | undefined {
  if (availableModels.some((m) => m.id === requestedModel)) {
    return requestedModel;
  }

  const normalizedRequest = normalize(requestedModel);
  const normalizedMatch = availableModels.find(
    (m) => normalize(m.id) === normalizedRequest,
  );
  if (normalizedMatch) {
    logger?.debug(
      `Model "${requestedModel}" resolved to "${normalizedMatch.id}" (normalized match)`,
    );
    return normalizedMatch.id;
  }

  // Requested version may not exist in Copilot yet (e.g. opus 4.6 falls back to opus 4.5),
  // so fall back to the closest model in the same family.
  const requestFamily = extractFamily(normalizedRequest);
  const familyMatches = availableModels.filter(
    (m) => extractFamily(normalize(m.id)) === requestFamily,
  );

  let best: ModelInfo | undefined;
  let bestLen = 0;
  for (const m of familyMatches) {
    const norm = normalize(m.id);
    let len = 0;
    const minLen = Math.min(normalizedRequest.length, norm.length);
    while (len < minLen && normalizedRequest[len] === norm[len]) len++;
    if (len > bestLen) {
      bestLen = len;
      best = m;
    }
  }

  if (!best) return undefined;

  logger?.warn(
    `Model "${requestedModel}" not available, falling back to "${best.id}" (closest in family)`,
  );
  return best.id;
}
