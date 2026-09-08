/**
 * [INPUT]: No dependencies; pure function only
 * [OUTPUT]: Provides normalizeGithubRepoUrl, the only source of truth for canonical GitHub repository URL and display-name normalization
 * [POS]: Shared GitHub repository URL contract; main and renderer both import this instead of duplicating the parsing rule
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
