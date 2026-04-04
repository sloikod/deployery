import path from 'node:path';

const configuredDockerVolumePath = process.env.DEPLOYERY_DOCKER_VOLUME_PATH?.trim();

export const DOCKER_VOLUME_PATH = configuredDockerVolumePath || '/data';

export const USER_HOME_PATH = '/home/user';
export const USER_CONFIG_HOME_PATH = path.join(USER_HOME_PATH, '.config');
export const USER_DATA_HOME_PATH = path.join(USER_HOME_PATH, '.local', 'share');

export const OPEN_EXTERNAL_PATH = '/_deployery/open-external';
export const WORKBENCH_BOOTSTRAP_PATH = '/_deployery/code-server/bootstrap.js';

export const INSTANCE_JSON_PATH = path.join(DOCKER_VOLUME_PATH, 'instance.json');
export const FILES_PATH = path.join(DOCKER_VOLUME_PATH, 'files');
export const DELETED_MARKERS_PATH = path.join(DOCKER_VOLUME_PATH, 'deleted-files');
