/**
 * [INPUT]: No dependencies; pure function only
 * [OUTPUT]: Provides normalizeGithubRepoUrl, the only source of truth for canonical GitHub repository URL and display-name normalization, and GITHUB_REPO_URL_UNSUPPORTED, the stable failure code it throws for anything but a repository home page
 * [POS]: apps/desktop/shared/platform; Shared GitHub repository URL contract; main and renderer both import this instead of duplicating the parsing rule, and each surface localizes the failure code itself
 */

const GITHUB_REPO_PATTERN =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** A bare machine code: shared code runs in every locale, so the caller owns the copy. */
export const GITHUB_REPO_URL_UNSUPPORTED = "GITHUB_REPO_URL_UNSUPPORTED";

export function normalizeGithubRepoUrl(value: string) {
  const match = value.trim().match(GITHUB_REPO_PATTERN);
  if (!match) throw new Error(GITHUB_REPO_URL_UNSUPPORTED);
  const owner = match[1];
  const repo = match[2];
  return {
    repoUrl: `https://github.com/${owner}/${repo}`,
    displayName: `${owner}/${repo}`,
  };
}
