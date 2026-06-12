/**
 * Transport helpers — the only two ways the plugin talks TO the IRCd.
 *
 *   1. JSON-RPC over the RPC listener (rpc-user creds, HTTP Basic auth) for
 *      the control plane: register / approve / suspend / unsuspend / delete /
 *      list / get. A plain `POST https://host:port/api` works — the RPC module
 *      accepts a one-shot HTTP POST, no WebSocket needed (rpc.c:686-693).
 *   2. Bearer REST under /pushbot/v1 (bot token) for the data plane:
 *      respond / defer / workflow events / messages / react / redact / join / part.
 *
 * Both run over the same TLS-forced listener (host:port).
 */
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { RPC_PATH } from './constants';
import type { ObbyCredentials } from './state';

type RequestCtx = IExecuteFunctions | IHookFunctions | IWebhookFunctions;

/** A JSON-RPC error carrying the IRCd error code (NOT_FOUND, DENIED, …). */
export class PushBotRpcError extends Error {
	constructor(
		message: string,
		readonly code: string | number,
	) {
		super(message);
		this.name = 'PushBotRpcError';
	}
}

/** A REST error (non-2xx from /pushbot/v1). */
export class PushBotRestError extends Error {
	constructor(
		message: string,
		readonly statusCode: number,
	) {
		super(message);
		this.name = 'PushBotRestError';
	}
}

function baseUrl(creds: ObbyCredentials): string {
	return `https://${creds.host}:${creds.port}`;
}

let rpcSeq = 0;

/**
 * Call a `pushbot.*` JSON-RPC method on the control plane.
 * @throws PushBotRpcError on a JSON-RPC error response (HTTP-level failures throw via httpRequest).
 */
export async function rpcCall<T = IDataObject>(
	ctx: RequestCtx,
	creds: ObbyCredentials,
	method: string,
	params: IDataObject = {},
): Promise<T> {
	const auth = 'Basic ' + Buffer.from(`${creds.rpcUser}:${creds.rpcPassword}`).toString('base64');
	const response = (await ctx.helpers.httpRequest({
		method: 'POST',
		url: `${baseUrl(creds)}${RPC_PATH}`,
		headers: { Authorization: auth, 'Content-Type': 'application/json' },
		body: { jsonrpc: '2.0', id: String(++rpcSeq), method, params },
		json: true,
		skipSslCertificateValidation: creds.allowUnauthorizedCerts,
	})) as IDataObject;

	const error = response.error as { code?: string | number; message?: string } | undefined;
	if (error) {
		throw new PushBotRpcError(error.message ?? 'RPC error', error.code ?? 'INTERNAL_ERROR');
	}
	return response.result as T;
}

/**
 * Make a Bearer-auth REST request against /pushbot/v1.
 * @param method 'GET' | 'POST' (the IRCd webserver speaks neither DELETE nor PATCH).
 * @param path   A value from RestPath.* (already percent-encoded).
 */
export async function restRequest<T = IDataObject>(
	ctx: RequestCtx,
	creds: ObbyCredentials,
	token: string,
	method: 'GET' | 'POST',
	path: string,
	body?: IDataObject,
): Promise<T> {
	const options: IHttpRequestOptions = {
		method: method as IHttpRequestMethods,
		url: `${baseUrl(creds)}${path}`,
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		json: true,
		skipSslCertificateValidation: creds.allowUnauthorizedCerts,
	};
	if (method === 'POST') {
		options.body = body ?? {};
	}
	return (await ctx.helpers.httpRequest(options)) as T;
}
