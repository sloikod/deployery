import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type InstanceFile = {
	schemaVersion: number;
	deployeryVersion: string;
};

const INSTANCE_SCHEMA_VERSION = 1;

export const readInstanceFile = async (instancePath: string): Promise<Partial<InstanceFile>> => {
	try {
		return JSON.parse(await readFile(instancePath, 'utf8')) as Partial<InstanceFile>;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
		throw error;
	}
};

export const writeInstanceFile = async (instancePath: string, next: InstanceFile) => {
	await mkdir(path.dirname(instancePath), {
		recursive: true,
	});
	await writeFile(instancePath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
};

export const ensureInstanceFile = async (instancePath: string, deployeryVersion: string) => {
	const current = await readInstanceFile(instancePath);
	const next: InstanceFile = {
		schemaVersion: INSTANCE_SCHEMA_VERSION,
		deployeryVersion,
	};

	if (
		current.schemaVersion === next.schemaVersion &&
		current.deployeryVersion === next.deployeryVersion
	) {
		return;
	}

	await writeInstanceFile(instancePath, next);
};
