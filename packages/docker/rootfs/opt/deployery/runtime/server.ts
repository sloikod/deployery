import {
	ServerResponse,
	IncomingMessage,
	createServer,
	request as httpRequest,
	type IncomingHttpHeaders,
} from 'node:http';
import { connect } from 'node:net';
import { type Duplex } from 'node:stream';
import { createBrowserBridge } from './browser-bridge.js';

// Per RFC 7230 section 6.1, proxies must not forward hop-by-hop headers.
const HOP_BY_HOP_HEADERS = new Set([
	'connection',
	'keep-alive',
	'transfer-encoding',
	'te',
	'trailer',
	'proxy-authorization',
	'proxy-authenticate',
	'upgrade',
]);

const filterProxyHeaders = (headers: IncomingHttpHeaders): IncomingHttpHeaders => {
	const connectionTokens = new Set(
		String(
			Array.isArray(headers['connection'])
				? headers['connection'].join(',')
				: (headers['connection'] ?? ''),
		)
			.split(',')
			.map((s) => s.trim().toLowerCase()),
	);

	return Object.fromEntries(
		Object.entries(headers).filter(
			([key]) => !HOP_BY_HOP_HEADERS.has(key) && !connectionTokens.has(key),
		),
	) as IncomingHttpHeaders;
};

const UPSTREAM_TIMEOUT_MS = 30_000;

const sendProxyUnavailable = (response: ServerResponse) => {
	response.writeHead(502, {
		'content-type': 'application/json; charset=utf-8',
	});
	response.end(
		JSON.stringify({
			error: 'code_server_unavailable',
		}),
	);
};

const proxyHttp = (request: IncomingMessage, response: ServerResponse, target: URL): void => {
	const upstream = httpRequest(
		{
			hostname: target.hostname,
			port: Number(target.port),
			path: request.url ?? '/',
			method: request.method,
			headers: filterProxyHeaders(request.headers),
		},
		(upstreamResponse) => {
			response.writeHead(
				upstreamResponse.statusCode ?? 502,
				filterProxyHeaders(upstreamResponse.headers),
			);
			upstreamResponse.pipe(response);
		},
	);
	upstream.setTimeout(UPSTREAM_TIMEOUT_MS, () => upstream.destroy());
	upstream.on('error', () => {
		if (!response.headersSent) sendProxyUnavailable(response);
	});
	request.pipe(upstream);
};

const proxyWebSocket = (
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer,
	target: URL,
): void => {
	const upstream = connect(Number(target.port), target.hostname);

	upstream.on('error', () => socket.destroy());
	socket.on('error', () => upstream.destroy());

	upstream.on('connect', () => {
		// Forward all headers because connection/upgrade are required for the WS handshake.
		const lines = [`${request.method} ${request.url} HTTP/1.1`];
		for (const [key, value] of Object.entries(request.headers)) {
			for (const v of Array.isArray(value) ? value : [value]) {
				if (v !== undefined) lines.push(`${key}: ${v}`);
			}
		}
		upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
		if (head.length) upstream.write(head);
		upstream.pipe(socket);
		socket.pipe(upstream);
	});
};

export const createAppServer = (target: URL) => {
	const browserBridge = createBrowserBridge();

	const server = createServer((request, response) => {
		if (browserBridge.handleRequest(request, response)) return;
		proxyHttp(request, response, target);
	});

	server.on('upgrade', (request, socket, head) => {
		proxyWebSocket(request, socket, head, target);
	});

	return server;
};
