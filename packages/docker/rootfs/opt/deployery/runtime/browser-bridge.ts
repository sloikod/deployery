import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import {
	OPEN_EXTERNAL_PATH,
	USER_CONFIG_HOME_PATH,
	USER_DATA_HOME_PATH,
	USER_HOME_PATH,
	WORKBENCH_BOOTSTRAP_PATH,
} from './path-constants.js';

const UI_BRIDGE_HEADER = 'x-deployery-ui-token';
const REQUEST_BODY_LIMIT_BYTES = 8 * 1024;

const CALLBACK_PARAM_NAMES = [
	'redirect_uri',
	'redirect_url',
	'redirectUrl',
	'callback',
	'callback_url',
	'callbackUrl',
];

class HttpRequestError extends Error {
	public readonly statusCode: number;
	public readonly errorCode: string;

	public constructor(statusCode: number, errorCode: string, message: string) {
		super(message);
		this.statusCode = statusCode;
		this.errorCode = errorCode;
	}
}

const getForwardedProto = (request: IncomingMessage) => {
	const raw = Array.isArray(request.headers['x-forwarded-proto'])
		? request.headers['x-forwarded-proto'][0]
		: request.headers['x-forwarded-proto'];
	const value = String(raw ?? '')
		.split(',')[0]
		?.trim()
		.toLowerCase();
	return value === 'https' ? 'https' : 'http';
};

const getRequestOrigin = (request: IncomingMessage) => {
	const host = request.headers.host ?? 'localhost';
	return `${getForwardedProto(request)}://${host}`;
};

const getRequestPathname = (request: IncomingMessage) => {
	try {
		return new URL(request.url ?? '/', getRequestOrigin(request)).pathname;
	} catch {
		return '/';
	}
};

const sendJson = (
	response: ServerResponse,
	statusCode: number,
	body: Record<string, unknown>,
	headers: Record<string, string> = {},
) => {
	response.writeHead(statusCode, {
		'cache-control': 'no-store',
		'content-type': 'application/json; charset=utf-8',
		...headers,
	});
	response.end(JSON.stringify(body));
};

const sendJavaScript = (response: ServerResponse, script: string) => {
	response.writeHead(200, {
		'cache-control': 'no-store',
		'content-type': 'application/javascript; charset=utf-8',
	});
	response.end(script);
};

const requireUiBridgeAuth = (request: IncomingMessage, uiBridgeToken: string) => {
	const origin = request.headers.origin;
	if (typeof origin !== 'string' || origin !== getRequestOrigin(request)) {
		throw new HttpRequestError(
			403,
			'same_origin_required',
			'same-origin browser requests are required',
		);
	}

	const header = request.headers[UI_BRIDGE_HEADER];
	if (typeof header !== 'string' || header !== uiBridgeToken) {
		throw new HttpRequestError(401, 'invalid_ui_bridge_token', 'invalid ui bridge token');
	}
};

const readJsonBody = async (request: IncomingMessage) =>
	new Promise<unknown>((resolve, reject) => {
		let body = '';
		let bodySize = 0;
		let done = false;

		request.setEncoding('utf8');
		request.on('data', (chunk: string) => {
			if (done) return;
			bodySize += Buffer.byteLength(chunk);
			if (bodySize > REQUEST_BODY_LIMIT_BYTES) {
				done = true;
				reject(new HttpRequestError(413, 'request_too_large', 'request body exceeds size limit'));
				request.resume();
				return;
			}
			body += chunk;
		});
		request.on('end', () => {
			if (done) return;
			try {
				resolve(JSON.parse(body));
			} catch {
				reject(new HttpRequestError(400, 'invalid_json', 'request body must be valid JSON'));
			}
		});
		request.on('error', (error) => {
			if (done) return;
			done = true;
			reject(error);
		});
	});

const normalizeHttpUrl = (value: unknown) => {
	if (typeof value !== 'string' || !value.trim()) {
		throw new HttpRequestError(400, 'invalid_url', 'url must be a non-empty string');
	}

	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new HttpRequestError(400, 'invalid_url', 'url must be a valid absolute URL');
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new HttpRequestError(400, 'invalid_url', 'url must use http or https');
	}

	return parsed.toString();
};

const getBrowserLaunchEnv = () => ({
	HOME: USER_HOME_PATH,
	USER: 'user',
	LOGNAME: 'user',
	SHELL: '/bin/bash',
	PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
	XDG_CONFIG_HOME: USER_CONFIG_HOME_PATH,
	XDG_DATA_HOME: USER_DATA_HOME_PATH,
});

const launchDefaultBrowser = (url: string) => {
	const child = spawn(
		'/usr/bin/sudo',
		[
			'-u',
			'user',
			'/usr/bin/env',
			'-i',
			...Object.entries(getBrowserLaunchEnv()).map(([key, value]) => `${key}=${value}`),
			'/usr/bin/xdg-open',
			url,
		],
		{
			detached: true,
			stdio: 'ignore',
		},
	);

	child.on('error', (error) => {
		console.error(`Failed to launch default browser for ${url}:`, error);
	});
	child.unref();
};

const renderWorkbenchBootstrap = (uiBridgeToken: string) =>
	[
		'(function () {',
		`  const openExternalEndpoint = ${JSON.stringify(OPEN_EXTERNAL_PATH)};`,
		`  const uiBridgeToken = ${JSON.stringify(uiBridgeToken)};`,
		`  const uiBridgeHeader = ${JSON.stringify(UI_BRIDGE_HEADER)};`,
		`  const callbackParamNames = ${JSON.stringify(CALLBACK_PARAM_NAMES)};`,
		'  const nativeWindowOpen = window.open.bind(window);',
		'',
		'  function parseHttpUrl(value) {',
		"    if (typeof value !== 'string' || !value.trim()) return null;",
		'    try {',
		'      const parsed = new URL(value, window.location.href);',
		"      return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;",
		'    } catch {',
		'      return null;',
		'    }',
		'  }',
		'',
		'  function isLoopbackHost(hostname) {',
		"    const normalized = String(hostname || '').trim().toLowerCase();",
		"    return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.startsWith('127.') || normalized === '::1' || normalized === '[::1]' || normalized === '0.0.0.0';",
		'  }',
		'',
		'  function hasLoopbackCallback(url) {',
		'    for (const key of callbackParamNames) {',
		'      const value = url.searchParams.get(key);',
		'      if (!value) continue;',
		'      const parsed = parseHttpUrl(value);',
		'      if (parsed && isLoopbackHost(parsed.hostname)) return true;',
		'    }',
		'    return false;',
		'  }',
		'',
		'  function shouldOpenInInstanceBrowser(value) {',
		'    const parsed = parseHttpUrl(value);',
		'    if (!parsed) return null;',
		'',
		'    const samePageHashOnly =',
		'      parsed.hash &&',
		'      parsed.origin === window.location.origin &&',
		'      parsed.pathname === window.location.pathname &&',
		'      parsed.search === window.location.search;',
		'',
		'    if (samePageHashOnly) return null;',
		'    if (isLoopbackHost(parsed.hostname) || hasLoopbackCallback(parsed)) return parsed.toString();',
		'    return null;',
		'  }',
		'',
		'  function requestInstanceBrowserOpen(href) {',
		'    const normalized = shouldOpenInInstanceBrowser(href);',
		'    if (!normalized) return false;',
		'',
		'    void fetch(openExternalEndpoint, {',
		"      method: 'POST',",
		'      headers: {',
		"        'content-type': 'application/json',",
		'        [uiBridgeHeader]: uiBridgeToken,',
		'      },',
		"      credentials: 'same-origin',",
		'      keepalive: true,',
		'      body: JSON.stringify({ url: normalized }),',
		'    }).then((response) => {',
		'      if (!response.ok) {',
		"        console.warn('deployery: instance browser open failed', response.status, normalized);",
		'      }',
		'    }).catch((error) => {',
		"      console.warn('deployery: failed to open external URL in instance', error);",
		'    });',
		'',
		'    return true;',
		'  }',
		'',
		'  function createWindowProxy(initialHref) {',
		"    const state = { closed: false, href: initialHref || '' };",
		'    return {',
		'      get closed() { return state.closed; },',
		'      set closed(value) { state.closed = !!value; },',
		'      close() { state.closed = true; },',
		'      focus() {},',
		'      blur() {},',
		'      opener: null,',
		'      location: {',
		'        get href() { return state.href; },',
		'        set href(value) {',
		'          state.href = String(value);',
		"          if (!requestInstanceBrowserOpen(state.href)) nativeWindowOpen(state.href, '_blank');",
		'        },',
		'        assign(value) { this.href = value; },',
		'        replace(value) { this.href = value; },',
		'      },',
		'    };',
		'  }',
		'',
		'  window.open = function (url, target, features) {',
		"    if (typeof url === 'undefined' || url === null || url === '') {",
		"      return createWindowProxy('');",
		'    }',
		'',
		'    const href = String(url);',
		'    if (requestInstanceBrowserOpen(href)) return createWindowProxy(href);',
		'    return nativeWindowOpen(url, target, features);',
		'  };',
		'',
		'  function findAnchor(event) {',
		"    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];",
		'    for (const entry of path) {',
		'      if (entry instanceof HTMLAnchorElement && entry.href) return entry;',
		'    }',
		"    return event.target instanceof Element ? event.target.closest('a[href]') : null;",
		'  }',
		'',
		'  function shouldHijackAnchor(anchor, event) {',
		"    if (!(anchor instanceof HTMLAnchorElement) || !anchor.href || anchor.hasAttribute('download')) return false;",
		'    if (!shouldOpenInInstanceBrowser(anchor.href)) return false;',
		"    if (anchor.target && anchor.target !== '_self') return true;",
		'    if (event.ctrlKey || event.metaKey || event.shiftKey) return true;',
		'    return event.button === 1 || event.button === 0;',
		'  }',
		'',
		'  function handleAnchorOpen(event) {',
		'    const anchor = findAnchor(event);',
		'    if (!shouldHijackAnchor(anchor, event)) return;',
		'    event.preventDefault();',
		'    event.stopPropagation();',
		'    requestInstanceBrowserOpen(anchor.href);',
		'  }',
		'',
		"  document.addEventListener('click', handleAnchorOpen, true);",
		"  document.addEventListener('auxclick', handleAnchorOpen, true);",
		'})();',
	]
		.join('\n')
		.trim();

const handleOpenExternal = async (
	request: IncomingMessage,
	response: ServerResponse,
	uiBridgeToken: string,
) => {
	try {
		if (request.method !== 'POST') {
			sendJson(
				response,
				405,
				{
					error: 'method_not_allowed',
				},
				{
					allow: 'POST',
				},
			);
			return;
		}

		requireUiBridgeAuth(request, uiBridgeToken);

		const body = await readJsonBody(request);
		const url = normalizeHttpUrl((body as { url?: unknown }).url);
		launchDefaultBrowser(url);

		sendJson(response, 202, {
			ok: true,
		});
	} catch (error) {
		if (error instanceof HttpRequestError) {
			sendJson(response, error.statusCode, {
				error: error.errorCode,
			});
			return;
		}

		console.error('Failed to process open-external request:', error);
		sendJson(response, 500, {
			error: 'internal_server_error',
		});
	}
};

export const createBrowserBridge = () => {
	const uiBridgeToken = randomBytes(32).toString('hex');

	return {
		handleRequest(request: IncomingMessage, response: ServerResponse) {
			const pathname = getRequestPathname(request);

			if (pathname === WORKBENCH_BOOTSTRAP_PATH) {
				if (request.method !== 'GET' && request.method !== 'HEAD') {
					sendJson(
						response,
						405,
						{
							error: 'method_not_allowed',
						},
						{
							allow: 'GET, HEAD',
						},
					);
					return true;
				}

				if (request.method === 'HEAD') {
					response.writeHead(200, {
						'cache-control': 'no-store',
						'content-type': 'application/javascript; charset=utf-8',
					});
					response.end();
					return true;
				}

				sendJavaScript(response, renderWorkbenchBootstrap(uiBridgeToken));
				return true;
			}

			if (pathname === OPEN_EXTERNAL_PATH) {
				void handleOpenExternal(request, response, uiBridgeToken);
				return true;
			}

			return false;
		},
	};
};
