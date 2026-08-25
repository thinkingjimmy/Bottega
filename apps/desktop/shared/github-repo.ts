/**
 * [INPUT]: The unreliable pure function module
 * [OUTPUT]: Provides normalize GitHubRepoUrl The only unified truth about the GitHub warehouse homepage address
 * [POS]: Shared warehouse address contracts; The main and renderer are taken from here, and they are prohibited from copying the rules
 */

const GITHUB_REPO_PATTERN =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

export function normalizeGithubRepoUrl(value: string) {
  const match = value.trim().match(GITHUB_REPO_PATTERN);
  if (!match) throw new Error("仅支持 GitHub 仓库主页地址");
  const owner = match[1];
  const repo = match[2];
  return {
    repoUrl: `https://github.com/${owner}/${repo}`,
    displayName: `${owner}/${repo}`,
  };
}
