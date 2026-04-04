export const SUPPORTED_DOCKER_PLATFORMS = ['linux/amd64', 'linux/arm64'];

export const PLATFORM_RUNNERS = {
	'linux/amd64': 'ubuntu-24.04',
	'linux/arm64': 'ubuntu-24.04-arm',
};

export const platformArchitecture = (platform) => {
	const architecture = platform.split('/').at(-1);
	if (!architecture) {
		throw new Error(`Unsupported platform "${platform}"`);
	}

	return architecture;
};
