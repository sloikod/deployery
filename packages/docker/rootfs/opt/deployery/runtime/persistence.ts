import {
	chmodSync,
	chownSync,
	copyFileSync,
	existsSync,
	lchownSync,
	linkSync,
	lstatSync,
	mkdirSync,
	rmdirSync,
	readdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	utimesSync,
	watch,
	writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import { DOCKER_VOLUME_PATH, DELETED_MARKERS_PATH, FILES_PATH } from './path-constants.js';

// Deletion markers cannot be stored at the mirrored path itself because that path
// may also be a directory holding markers for paths underneath it. For example,
// /home/user cannot be both the marker file for a deleted /home/user AND a directory
// containing a marker for a deleted /home/user/foo. The suffix stores the marker as
// a sibling: /data/deleted-files/home/user.__deleted__
const DELETION_SUFFIX = '.__deleted__';

const LOG_PREFIX = '[persistence]';
const EVENT_BATCH_WINDOW_MS = 200;

const EXCLUDED_EXACT = new Set([
	'/',
	'/.dockerenv',
	'/etc/hostname',
	'/etc/hosts',
	'/etc/resolv.conf',
	'/var/lib/apt/lists/lock',
	'/var/lib/dpkg/lock',
	'/var/lib/dpkg/lock-frontend',
	'/var/lib/dpkg/triggers/Lock',
]);

const EXCLUDED_PREFIXES = [
	'/dev',
	DOCKER_VOLUME_PATH,
	'/opt/deployery',
	'/proc',
	'/run',
	'/sys',
	'/tmp',
	'/var/cache/apt/archives',
	'/var/run',
];

function log(message: string): void {
	console.log(`${LOG_PREFIX} ${message}`);
}

function normalizePath(p: string): string {
	return normalize(resolve(p));
}

function isExcluded(normalized: string): boolean {
	if (EXCLUDED_EXACT.has(normalized)) return true;
	return EXCLUDED_PREFIXES.some(
		(prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
	);
}

function mirrorPathFor(normalized: string): string {
	return join(FILES_PATH, normalized.slice(1));
}

function deletionMarkerFor(normalized: string): string {
	if (normalized === '/') throw new Error('the root path cannot be marked as deleted');
	const rel = normalized.slice(1);
	return join(DELETED_MARKERS_PATH, dirname(rel), `${basename(rel)}${DELETION_SUFFIX}`);
}

function deletionSubtreeFor(normalized: string): string {
	return join(DELETED_MARKERS_PATH, normalized.slice(1));
}

function ensureLayout(): void {
	for (const dir of [FILES_PATH, DELETED_MARKERS_PATH]) {
		mkdirSync(dir, { recursive: true });
	}
}

function pruneEmptyDirectories(start: string, stop: string): void {
	let current = start;
	while (current !== stop) {
		try {
			rmdirSync(current);
		} catch {
			return;
		}
		current = dirname(current);
	}
}

function removePath(p: string): void {
	try {
		const st = lstatSync(p);
		rmSync(p, st.isDirectory() ? { recursive: true, force: true } : { force: true });
	} catch {
		// already gone
	}
}

// When a path comes back to life, clear any deletion markers for it and its ancestors.
// Always runs unconditionally - markers may exist from previous container sessions even
// if no deletions have been recorded in the current session.
function clearDeletionMarkers(normalized: string): void {
	let current = normalized;
	while (current !== '/') {
		const marker = deletionMarkerFor(current);
		try {
			unlinkSync(marker);
		} catch {
			/* no marker at this level, ok */
		}
		pruneEmptyDirectories(dirname(marker), DELETED_MARKERS_PATH);
		current = dirname(current);
	}

	const subtree = deletionSubtreeFor(normalized);
	if (existsSync(subtree)) {
		rmSync(subtree, { recursive: true, force: true });
		pruneEmptyDirectories(dirname(subtree), DELETED_MARKERS_PATH);
	}
}

function recordDeletion(normalized: string): void {
	removePath(mirrorPathFor(normalized));

	const subtree = deletionSubtreeFor(normalized);
	if (existsSync(subtree)) rmSync(subtree, { recursive: true, force: true });

	const marker = deletionMarkerFor(normalized);
	mkdirSync(dirname(marker), { recursive: true });
	writeFileSync(marker, '');
}

function rsync(args: string[]): void {
	const result = spawnSync('rsync', args, { encoding: 'utf8' });
	if (result.status !== 0) {
		const message =
			(result.stderr || result.stdout || '').trim() ||
			`rsync exited with ${result.status ?? 'null'}`;
		throw new Error(message);
	}
}

// Returns stats if the path should be mirrored, null otherwise.
// Side effect: records a deletion if the path no longer exists.
function statForMirror(normalized: string): import('node:fs').Stats | null {
	if (isExcluded(normalized)) return null;

	let st: import('node:fs').Stats;
	try {
		st = lstatSync(normalized);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			recordDeletion(normalized);
			return null;
		}
		throw err;
	}

	if (st.isFIFO() || st.isSocket() || st.isBlockDevice() || st.isCharacterDevice()) return null;

	clearDeletionMarkers(normalized);
	return st;
}

// Mirrors the metadata of all ancestor directories into FILES_PATH.
// Required because mkdirSync({ recursive: true }) creates directories with root
// ownership - without this, restored directories like /home/user would be root-owned.
function mirrorAncestors(normalized: string): void {
	const ancestors: string[] = [];
	let current = dirname(normalized);
	while (current !== '/') {
		ancestors.unshift(current);
		current = dirname(current);
	}

	for (const ancestor of ancestors) {
		const dest = mirrorPathFor(ancestor);
		try {
			const st = lstatSync(ancestor);
			if (st.isDirectory()) {
				try {
					if (!lstatSync(dest).isDirectory()) rmSync(dest, { force: true });
				} catch {
					/* dest doesn't exist, ok */
				}
				mkdirSync(dest, { recursive: true });
				chownSync(dest, st.uid, st.gid);
				chmodSync(dest, st.mode & 0o7777);
				utimesSync(dest, st.atime, st.mtime);
			} else if (st.isSymbolicLink()) {
				removePath(dest);
				mkdirSync(dirname(dest), { recursive: true });
				symlinkSync(readlinkSync(ancestor), dest);
				lchownSync(dest, st.uid, st.gid);
			}
		} catch {
			continue;
		}
	}
}

// Maps live-fs inode -> path in FILES_PATH for hard link preservation.
const hardLinkMap = new Map<number, string>();

function mirrorPath(src: string, dest: string, st: import('node:fs').Stats): void {
	mirrorAncestors(src);

	if (st.isSymbolicLink()) {
		removePath(dest);
		symlinkSync(readlinkSync(src), dest);
		lchownSync(dest, st.uid, st.gid);
	} else if (st.isDirectory()) {
		try {
			if (!lstatSync(dest).isDirectory()) rmSync(dest, { force: true });
		} catch {
			/* dest doesn't exist, ok */
		}
		mkdirSync(dest, { recursive: true });
		chownSync(dest, st.uid, st.gid);
		chmodSync(dest, st.mode & 0o7777);
		utimesSync(dest, st.atime, st.mtime);
	} else {
		try {
			const d = lstatSync(dest);
			if (d.isDirectory()) rmSync(dest, { recursive: true, force: true });
			else if (d.isSymbolicLink()) unlinkSync(dest);
		} catch {
			/* dest doesn't exist, ok */
		}

		// Preserve hard links: if this inode is already mirrored elsewhere, link to it.
		if (st.nlink > 1) {
			const existing = hardLinkMap.get(st.ino);
			if (existing) {
				try {
					if (lstatSync(existing).isFile()) {
						removePath(dest);
						linkSync(existing, dest);
						chownSync(dest, st.uid, st.gid);
						chmodSync(dest, st.mode & 0o7777);
						utimesSync(dest, st.atime, st.mtime);
						return;
					}
				} catch {
					/* existing mirror gone, fall through to copy */
				}
			}
			hardLinkMap.set(st.ino, dest);
		}

		// Copy with consistency check: if mtime or size changes during the copy the
		// file was written mid-copy - retry to avoid persisting a partial snapshot.
		let currentSt = st;
		for (let attempt = 0; attempt < 3; attempt++) {
			copyFileSync(src, dest);
			try {
				const after = lstatSync(src);
				if (after.mtimeMs === currentSt.mtimeMs && after.size === currentSt.size) break;
				currentSt = after;
			} catch {
				break; // file gone after copy, best effort
			}
		}
		chownSync(dest, currentSt.uid, currentSt.gid);
		chmodSync(dest, currentSt.mode & 0o7777);
		utimesSync(dest, currentSt.atime, currentSt.mtime);
	}
}

function findDeletions(): string[] {
	if (!existsSync(DELETED_MARKERS_PATH)) return [];
	const entries = readdirSync(DELETED_MARKERS_PATH, { encoding: 'utf8', recursive: true });
	return (entries as string[])
		.filter((f) => f.endsWith(DELETION_SUFFIX))
		.sort()
		.map((f) => join(DELETED_MARKERS_PATH, f));
}

function restoreFilesystem(): void {
	ensureLayout();

	if (readdirSync(FILES_PATH).length > 0) {
		log(`restoring persisted paths from ${FILES_PATH}`);
		rsync(['-a', '-H', '--numeric-ids', `${FILES_PATH}/`, '/']);
	}

	const deletions = findDeletions();
	for (const marker of deletions) {
		const rel = marker.slice(DELETED_MARKERS_PATH.length + 1);
		const target = normalizePath(
			join('/', dirname(rel), basename(rel).slice(0, -DELETION_SUFFIX.length)),
		);
		if (isExcluded(target)) continue;
		removePath(target);
	}

	if (deletions.length > 0) log(`applied ${deletions.length} persisted delete markers`);
}

// --- Daemon ---

const pending = new Map<string, 'sync' | 'delete'>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function queueSync(path: string): void {
	pending.set(path, 'sync');
	scheduleBatch();
}

function queueDelete(path: string): void {
	pending.set(path, 'delete');
	scheduleBatch();
}

function scheduleBatch(): void {
	if (batchTimer !== null) return;
	batchTimer = setTimeout(flushBatch, EVENT_BATCH_WINDOW_MS);
}

function flushBatch(): void {
	batchTimer = null;

	const deletePaths: string[] = [];
	const syncPaths: string[] = [];
	for (const [p, a] of pending) {
		if (a === 'delete') deletePaths.push(p);
		else syncPaths.push(p);
	}
	pending.clear();

	deletePaths.sort((a, b) => b.length - a.length);
	syncPaths.sort((a, b) => a.length - b.length);

	for (const p of deletePaths) {
		try {
			recordDeletion(p);
		} catch (e) {
			log(`error recording delete for ${p}: ${e}`);
		}
	}

	for (const p of syncPaths) {
		if (deletePaths.some((dp) => p !== dp && p.startsWith(`${dp}/`))) continue;
		try {
			const st = statForMirror(p);
			if (st === null) continue;
			mirrorPath(p, mirrorPathFor(p), st);
		} catch (e) {
			log(`error mirroring ${p}: ${e}`);
		}
	}
}

function handleFsEvent(eventType: string, fullPath: string): void {
	if (isExcluded(fullPath)) return;
	if (eventType === 'change') {
		queueSync(fullPath);
		return;
	}
	// 'rename': created, deleted, or renamed
	try {
		const st = lstatSync(fullPath);
		queueSync(fullPath);
		// If a directory appeared, immediately queue its existing contents.
		// This closes the race between inotify watch registration and file
		// creation events inside newly created directories.
		if (st.isDirectory()) {
			for (const rel of readdirSync(fullPath, {
				encoding: 'utf8',
				recursive: true,
			}) as string[]) {
				const child = normalizePath(join(fullPath, rel));
				if (!isExcluded(child)) queueSync(child);
			}
		}
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') queueDelete(fullPath);
	}
}

const watchedRoots = new Set<string>();

function watchRootDir(normalized: string): void {
	if (isExcluded(normalized)) return;
	if (watchedRoots.has(normalized)) return;

	let st: import('node:fs').Stats;
	try {
		st = lstatSync(normalized);
	} catch {
		return;
	}

	if (!st.isDirectory()) return;
	if (resolve(normalized, '..') !== '/') return;

	watchedRoots.add(normalized);
	watch(normalized, { recursive: true }, (eventType, filename) => {
		if (filename == null) return;
		handleFsEvent(eventType, normalizePath(join(normalized, filename.toString())));
	});
}

function runDaemon(): void {
	ensureLayout();

	// Watch / to detect new top-level directories and handle events on top-level paths.
	watch('/', { recursive: false }, (eventType, filename) => {
		if (filename == null) return;
		const fullPath = normalizePath(`/${filename.toString()}`);
		watchRootDir(fullPath);
		handleFsEvent(eventType, fullPath);
	});

	// Watch all existing top-level directories recursively.
	for (const entry of readdirSync('/', { withFileTypes: true })) {
		if (entry.isDirectory()) watchRootDir(normalizePath(`/${entry.name}`));
	}

	log('live mirror daemon is watching the filesystem');
}

// --- CLI ---

process.on('SIGTERM', () => {
	flushBatch();
	process.exit(0);
});

const mode = process.argv[2];

try {
	if (mode === 'restore') {
		restoreFilesystem();
	} else if (mode === 'daemon') {
		runDaemon();
	} else {
		console.error('Usage: persistence.ts <restore|daemon>');
		process.exit(1);
	}
} catch (error) {
	log(String(error));
	process.exit(1);
}
