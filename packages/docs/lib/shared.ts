import {
	PROJECT_NAME,
	DOCS_DEV_SITE_URL,
	DOCS_SITE_URL,
	GITHUB_URL,
	REPO_BETA_BRANCH,
	REPO_NAME,
	REPO_OWNER,
	REPO_STABLE_BRANCH,
} from '@deployery/constants';

export const projectName = PROJECT_NAME;
export const docsRoute = '/';
export const docsImageRoute = '/og/docs';
export const docsContentRoute = '/llms.mdx/docs';

export const siteUrl = DOCS_SITE_URL;
// The canonical site URL is repo identity, while metadataBase needs a local dev
// origin during `next dev`.
export const metadataBaseUrl =
	process.env.NODE_ENV === 'development' ? DOCS_DEV_SITE_URL : DOCS_SITE_URL;
export const repositoryUrl = GITHUB_URL;

export const gitConfig = {
	user: REPO_OWNER,
	repo: REPO_NAME,
	stableBranch: REPO_STABLE_BRANCH,
	betaBranch: REPO_BETA_BRANCH,
};
