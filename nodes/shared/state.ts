/**
 * Credential normalisation + per-bot secret persistence.
 *
 * n8n nodes cannot write back to the credential store at runtime, so the
 * secrets minted by `pushbot.register` (bot_id, token, webhook_secret) live
 * in workflow static data — the sanctioned home for runtime-generated tokens
 * that must survive across executions. The credential itself only carries the
 * durable, operator-entered fields, plus an optional manual override for
 * advanced cross-workflow use.
 *
 * Keyed by `${host}:${port}/${botNick}` so a single workflow can drive more
 * than one bot.
 */
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	ITriggerFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { BotStatus } from './constants';
import type { BotSecrets } from './types';

/** The decrypted `obbyircdPushBotApi` credential, flattened. */
export interface ObbyCredentials {
	host: string;
	port: number;
	rpcUser: string;
	rpcPassword: string;
	registrationSecret?: string;
	botNick: string;
	allowUnauthorizedCerts: boolean;
	/** Manual override (advanced). When `token` is set, it wins over static-data secrets. */
	botId?: string;
	token?: string;
	webhookSecret?: string;
}

type AnyCtx = IExecuteFunctions | ITriggerFunctions | IWebhookFunctions | IHookFunctions;

const CREDENTIAL_NAME = 'obbyircdPushBotApi';

/** Read + normalise the credential (flattening the manual-override collection). */
export async function getObbyCredentials(ctx: AnyCtx): Promise<ObbyCredentials> {
	const raw = (await ctx.getCredentials(CREDENTIAL_NAME)) as IDataObject;
	const override = ((raw.manualOverride as IDataObject)?.values ?? {}) as IDataObject;
	return {
		host: String(raw.host ?? ''),
		port: Number(raw.port ?? 8600),
		rpcUser: String(raw.rpcUser ?? ''),
		rpcPassword: String(raw.rpcPassword ?? ''),
		registrationSecret: raw.registrationSecret ? String(raw.registrationSecret) : undefined,
		botNick: String(raw.botNick ?? ''),
		allowUnauthorizedCerts: Boolean(raw.allowUnauthorizedCerts ?? false),
		botId: override.botId ? String(override.botId) : undefined,
		token: override.token ? String(override.token) : undefined,
		webhookSecret: override.webhookSecret ? String(override.webhookSecret) : undefined,
	};
}

/** Stable key for a (server, bot) pair within workflow static data. */
export function botKey(creds: ObbyCredentials): string {
	return `pushbot:${creds.host}:${creds.port}/${creds.botNick}`;
}

function store(ctx: AnyCtx): IDataObject {
	return ctx.getWorkflowStaticData('global') as IDataObject;
}

/** Read minted secrets for this bot: credential override first, then static data, else null. */
export function loadSecrets(ctx: AnyCtx, creds: ObbyCredentials): BotSecrets | null {
	if (creds.token) {
		return {
			bot_id: creds.botId ?? '',
			token: creds.token,
			webhook_secret: creds.webhookSecret ?? '',
			webhook_url: '',
			status: BotStatus.Active,
		};
	}
	const entry = store(ctx)[botKey(creds)] as BotSecrets | undefined;
	return entry ?? null;
}

/** Persist minted secrets after a successful register/rotate. */
export function saveSecrets(ctx: AnyCtx, creds: ObbyCredentials, secrets: BotSecrets): void {
	store(ctx)[botKey(creds)] = secrets as unknown as IDataObject;
}

/** Drop persisted secrets (only on an explicit Delete — not on routine deactivate). */
export function clearSecrets(ctx: AnyCtx, creds: ObbyCredentials): void {
	delete store(ctx)[botKey(creds)];
}
