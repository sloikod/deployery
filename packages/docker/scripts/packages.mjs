import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';

const dockerPackagePath = process.cwd();
const dockerfilePath = path.join(dockerPackagePath, 'Dockerfile');
const shouldAutoWrite = process.argv.includes('-y');
let dockerfile = await readFile(dockerfilePath, 'utf8');

const SUPPORTED_ARCHES = ['AMD64', 'ARM64'];
const NODE_DIST_ARCH = {
	AMD64: 'x64',
	ARM64: 'arm64',
};

function getArg(name) {
	const match = dockerfile.match(new RegExp(`^ARG ${name}=(.+)$`, 'm'));
	if (!match) {
		throw new Error(`Missing ARG ${name} in ${dockerfilePath}`);
	}

	return match[1].trim();
}

function getArchArgs(prefix) {
	return Object.fromEntries(
		SUPPORTED_ARCHES.map((arch) => [`${prefix}_${arch}`, getArg(`${prefix}_${arch}`)]),
	);
}

function parseAptPins() {
	const marker = 'apt-get install -y --no-install-recommends';
	const start = dockerfile.indexOf(marker);

	if (start === -1) {
		throw new Error('Could not find apt-get install block in Dockerfile');
	}

	const end = dockerfile.indexOf('useradd --create-home', start);

	if (end === -1) {
		throw new Error('Could not find end of apt-get install block in Dockerfile');
	}

	const block = dockerfile.slice(start, end);
	const pins = [];

	for (const line of block.split('\n')) {
		const match = line.match(/^\s*([a-z0-9.+-]+)=([^\s;\\]+)\s*(?:;\s*)?(?:\\\s*)?$/i);
		if (match) {
			pins.push({
				name: match[1],
				version: match[2],
			});
		}
	}

	return pins;
}

async function fetchJson(url, init) {
	const response = await fetch(url, init);
	if (!response.ok) {
		throw new Error(`Request failed: ${url} (${response.status})`);
	}

	return response.json();
}

async function fetchText(url, init) {
	const response = await fetch(url, init);
	if (!response.ok) {
		throw new Error(`Request failed: ${url} (${response.status})`);
	}

	return response.text();
}

function runDocker(args) {
	return execFileSync('docker', args, {
		cwd: dockerPackagePath,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

function getRuntimeImageParts(runtimeImage) {
	const [tagPart, digest] = runtimeImage.split('@sha256:', 2);
	if (!tagPart || !digest) {
		throw new Error(`Unexpected RUNTIME_IMAGE format: ${runtimeImage}`);
	}

	return {
		tagPart,
		digest,
	};
}

function getImageIndexDigest(imagetoolsOutput) {
	const match = imagetoolsOutput.match(/^\s*Digest:\s+sha256:([a-f0-9]{64})$/m);
	if (!match) {
		throw new Error('Could not find image index digest in docker imagetools output');
	}

	return match[1];
}

function getCandidateVersionsFromDocker(imageTag, packageNames) {
	const packageList = packageNames.join(' ');
	const script = [
		'set -eu',
		'apt-get update >/dev/null',
		`for pkg in ${packageList}; do`,
		'  candidate=$(apt-cache policy "$pkg" | awk \'/Candidate:/ {print $2; exit}\')',
		'  printf \'%s=%s\\n\' "$pkg" "$candidate"',
		'done',
	].join('\n');

	const output = runDocker(['run', '--rm', imageTag, 'bash', '-lc', script]);
	const map = new Map();

	for (const line of output.split(/\r?\n/)) {
		const [name, version] = line.split('=');
		if (name && version) {
			map.set(name, version);
		}
	}

	return map;
}

function formatValue(value) {
	if (value.length <= 24) {
		return value;
	}

	return `${value.slice(0, 12)}...${value.slice(-12)}`;
}

function renderTable(rows) {
	const headers = ['Package', 'Current', 'Latest'];
	const widths = headers.map((header, index) =>
		Math.max(header.length, ...rows.map((row) => row[index].length)),
	);

	function line(separator, edge = '+') {
		return `${edge}${widths.map((width) => '-'.repeat(width + 2)).join(separator)}${edge}`;
	}

	function renderRow(columns) {
		return `| ${columns.map((column, index) => column.padEnd(widths[index])).join(' | ')} |`;
	}

	console.log(line('+'));
	console.log(renderRow(headers));
	console.log(line('+'));

	rows.forEach((row, index) => {
		console.log(renderRow(row));
		if (index < rows.length - 1) {
			console.log(line('+'));
		}
	});

	console.log(line('+'));
}

async function confirmWrite(outdatedCount) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return false;
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const answer = await rl.question(`\nApply ${outdatedCount} update(s) to Dockerfile? [y/N] `);
		return /^(y|yes)$/i.test(answer.trim());
	} finally {
		rl.close();
	}
}

const runtimeImage = getArg('RUNTIME_IMAGE');
const nodeVersion = getArg('NODE_VERSION');
const nodeShasByArg = getArchArgs('NODE_SHA256');
const codeServerVersion = getArg('CODE_SERVER_VERSION');
const codeServerShasByArg = getArchArgs('CODE_SERVER_SHA256');
const tsxVersion = getArg('TSX_VERSION');
const flowIconsVersion = getArg('FLOW_ICONS_VERSION');
const flowIconsSha256 = getArg('FLOW_ICONS_SHA256');
const aptPins = parseAptPins();

const nodeIndex = await fetchJson('https://nodejs.org/dist/index.json');
const latestNode24 = nodeIndex.find((release) => release.version.startsWith('v24.'));
if (!latestNode24) {
	throw new Error('Could not find latest Node 24 release');
}

const latestNodeVersion = latestNode24.version.slice(1);
const latestNodeShasText = await fetchText(
	`https://nodejs.org/dist/v${latestNodeVersion}/SHASUMS256.txt`,
);
const latestNodeShasByArg = Object.fromEntries(
	SUPPORTED_ARCHES.map((arch) => {
		const nodeDistArch = NODE_DIST_ARCH[arch];
		const sha = latestNodeShasText
			.split(/\r?\n/)
			.map((line) => line.trim())
			.find((line) => line.endsWith(`node-v${latestNodeVersion}-linux-${nodeDistArch}.tar.xz`))
			?.split(/\s+/)[0];

		if (!sha) {
			throw new Error(`Could not find Node SHA for v${latestNodeVersion} (${arch.toLowerCase()})`);
		}

		return [`NODE_SHA256_${arch}`, sha];
	}),
);

const codeServerRelease = await fetchJson(
	'https://api.github.com/repos/coder/code-server/releases/latest',
	{
		headers: {
			'User-Agent': 'deployery-docker-version-audit',
		},
	},
);
const latestCodeServerVersion = String(codeServerRelease.tag_name).replace(/^v/, '');
const latestCodeServerShasByArg = Object.fromEntries(
	SUPPORTED_ARCHES.map((arch) => {
		const asset = codeServerRelease.assets.find(
			(releaseAsset) =>
				releaseAsset.name ===
				`code-server-${latestCodeServerVersion}-linux-${arch.toLowerCase()}.tar.gz`,
		);

		if (!asset?.digest) {
			throw new Error(
				`Could not find digest for code-server ${latestCodeServerVersion} (${arch.toLowerCase()})`,
			);
		}

		return [`CODE_SERVER_SHA256_${arch}`, String(asset.digest).replace(/^sha256:/, '')];
	}),
);

const tsxPackage = await fetchJson('https://registry.npmjs.org/tsx');
const latestTsxVersion = tsxPackage['dist-tags']?.latest;
if (!latestTsxVersion) {
	throw new Error('Could not determine latest tsx version');
}

const flowIconsRelease = await fetchJson('https://open-vsx.org/api/thang-nm/flow-icons/latest');
const latestFlowIconsVersion = String(flowIconsRelease.version);
const latestFlowIconsSha256 = String(
	await fetchText(
		`https://open-vsx.org/api/thang-nm/flow-icons/${latestFlowIconsVersion}/file/thang-nm.flow-icons-${latestFlowIconsVersion}.sha256`,
	),
)
	.trim()
	.split(/\s+/)[0];

if (!latestFlowIconsVersion || !latestFlowIconsSha256) {
	throw new Error('Could not determine latest Flow Icons version and SHA256');
}

const { tagPart: runtimeTag, digest: currentRuntimeDigest } = getRuntimeImageParts(runtimeImage);
const imagetoolsOutput = runDocker(['buildx', 'imagetools', 'inspect', runtimeTag]);
const latestRuntimeDigest = getImageIndexDigest(imagetoolsOutput);

const aptCandidateVersions = getCandidateVersionsFromDocker(
	runtimeTag,
	aptPins.map((pkg) => pkg.name),
);
const packageResults = aptPins.map((pkg) => ({
	...pkg,
	latest: aptCandidateVersions.get(pkg.name) ?? 'UNKNOWN',
}));

const checks = [
	{
		name: 'Base image digest',
		current: currentRuntimeDigest,
		latest: latestRuntimeDigest,
	},
	{
		name: 'Node',
		current: nodeVersion,
		latest: latestNodeVersion,
	},
	...SUPPORTED_ARCHES.map((arch) => ({
		name: `Node SHA256 (${arch.toLowerCase()})`,
		current: nodeShasByArg[`NODE_SHA256_${arch}`],
		latest: latestNodeShasByArg[`NODE_SHA256_${arch}`],
	})),
	{
		name: 'code-server',
		current: codeServerVersion,
		latest: latestCodeServerVersion,
	},
	...SUPPORTED_ARCHES.map((arch) => ({
		name: `code-server SHA256 (${arch.toLowerCase()})`,
		current: codeServerShasByArg[`CODE_SERVER_SHA256_${arch}`],
		latest: latestCodeServerShasByArg[`CODE_SERVER_SHA256_${arch}`],
	})),
	{
		name: 'tsx',
		current: tsxVersion,
		latest: latestTsxVersion,
	},
	{
		name: 'flow-icons',
		current: flowIconsVersion,
		latest: latestFlowIconsVersion,
	},
	{
		name: 'flow-icons SHA256',
		current: flowIconsSha256,
		latest: latestFlowIconsSha256,
	},
	...packageResults.map((pkg) => ({
		name: `apt:${pkg.name}`,
		current: pkg.version,
		latest: pkg.latest,
	})),
];

const outdated = checks.filter((check) => check.current !== check.latest);

console.log(
	`Checked ${checks.length} version pins in ${path.relative(dockerPackagePath, dockerfilePath)}.`,
);

if (outdated.length > 0) {
	renderTable(
		outdated.map((check) => [check.name, formatValue(check.current), formatValue(check.latest)]),
	);

	const shouldWrite = shouldAutoWrite || (await confirmWrite(outdated.length));

	if (shouldWrite) {
		const replacements = new Map([
			['RUNTIME_IMAGE', `${runtimeTag}@sha256:${latestRuntimeDigest}`],
			['NODE_VERSION', latestNodeVersion],
			['CODE_SERVER_VERSION', latestCodeServerVersion],
			['TSX_VERSION', latestTsxVersion],
			['FLOW_ICONS_VERSION', latestFlowIconsVersion],
			['FLOW_ICONS_SHA256', latestFlowIconsSha256],
			...Object.entries(latestNodeShasByArg),
			...Object.entries(latestCodeServerShasByArg),
			...packageResults.map((pkg) => [pkg.name, pkg.latest]),
		]);

		dockerfile = dockerfile.replace(
			/^ARG (RUNTIME_IMAGE|NODE_VERSION|NODE_SHA256_(?:AMD64|ARM64)|CODE_SERVER_VERSION|CODE_SERVER_SHA256_(?:AMD64|ARM64)|TSX_VERSION|FLOW_ICONS_VERSION|FLOW_ICONS_SHA256)=(.+)$/gm,
			(full, name) => {
				const next = replacements.get(name);
				return next ? `ARG ${name}=${next}` : full;
			},
		);

		for (const pkg of packageResults) {
			const escapedName = pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const matcher = new RegExp(`(^\\s*${escapedName}=)([^\\s;\\\\]+)`, 'gm');
			dockerfile = dockerfile.replace(matcher, `$1${pkg.latest}`);
		}

		await writeFile(dockerfilePath, dockerfile, 'utf8');
		console.log(`\nUpdated the Dockerfile to fix ${outdated.length} outdated pin(s).`);
	} else {
		console.log(`\nFound ${outdated.length} outdated pin(s). Dockerfile was left unchanged.`);
		console.log('Re-run with -y to update automatically.');
	}
} else {
	console.log('\nEverything is up to date.');
}
