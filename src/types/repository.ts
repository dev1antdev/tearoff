/**
 * The GitHub repository this build is released from, as `owner/name`.
 *
 * Release notes are read from here. The auto-updater reads the same repository
 * from `repository.url` in package.json and the release publisher from
 * forge.config.mts; neither can import this, so all three have to be kept
 * pointing at the same place by hand.
 */
export const GITHUB_REPOSITORY = 'dev1antdev/tearoff';

/** `https://github.com/<owner>/<name>`, without a trailing slash. */
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY}`;
