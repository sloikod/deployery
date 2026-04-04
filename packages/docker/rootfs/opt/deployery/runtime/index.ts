import { mkdir } from 'node:fs/promises';
import { DOCKER_VOLUME_PATH, INSTANCE_JSON_PATH } from './path-constants.js';
import { ensureInstanceFile } from './instance.json.js';
import { createAppServer } from './server.js';

// code-server is private to the container and must stay aligned with the
// supervisord bind address; this is not repo-level shared config.
const CODE_SERVER_ORIGIN = new URL('http://127.0.0.1:13337');
const DEPLOYERY_VERSION = process.env.DEPLOYERY_VERSION?.trim() || 'unknown';

const parsePort = (value: string | undefined) => {
	const port = Number.parseInt(value ?? '', 10);
	// PORT is real runtime config, but 8080 remains the container default used
	// by local runs, Docker metadata, and smoke tests.
	return Number.isInteger(port) && port > 0 ? port : 8080;
};

const main = async () => {
	await mkdir(DOCKER_VOLUME_PATH, {
		recursive: true,
	});
	await ensureInstanceFile(INSTANCE_JSON_PATH, DEPLOYERY_VERSION);

	const server = createAppServer(CODE_SERVER_ORIGIN);
	server.listen(parsePort(process.env.PORT));
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
