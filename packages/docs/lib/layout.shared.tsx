import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { projectName, repositoryUrl, siteUrl } from './shared';

export function baseOptions(): BaseLayoutProps {
	return {
		nav: {
			title: projectName,
			url: siteUrl,
		},
		githubUrl: repositoryUrl,
	};
}
