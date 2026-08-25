/**
 * [INPUT]: Depends on the agent identity string
 * [OUTPUT]: Provides hashAgentIdentity with agent AvatarRecipe to generate reproducible abstract head image parameters
 * [POS]: The lib algorithm headers are like pure functions; React Canvas is solely responsible for the recipe's lighting
 */

export type AgentAvatarRecipe = {
  palette: readonly [string, string, string, string];
  rotation: number;
  inset: number;
  twist: number;
};

const PALETTES = [
  ["#ffad52", "#ffc477", "#ff9738", "#ffd7a2"],
  ["#8bdc78", "#b7eca8", "#68c85a", "#d8f5cf"],
  ["#9b8ad0", "#c2b7e4", "#7d69bb", "#ddd7ef"],
  ["#f3ce46", "#ffe27c", "#e9b92e", "#fff0ad"],
  ["#77c7d8", "#a9dfE8", "#4fb1c5", "#d5f0f4"],
  ["#eb89ad", "#f4b2c9", "#dd668f", "#f9d7e3"],
] as const;

export function hashAgentIdentity(identity: string) {
  let hash = 0x811c9dc5;
  for (const character of identity) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function agentAvatarRecipe(identity: string): AgentAvatarRecipe {
  const hash = hashAgentIdentity(identity);
  return {
    palette: PALETTES[hash % PALETTES.length],
    rotation: ((hash >>> 5) % 360) * (Math.PI / 180),
    inset: 0.16 + ((hash >>> 13) % 7) / 100,
    twist: 0.2 + ((hash >>> 19) % 9) / 100,
  };
}
