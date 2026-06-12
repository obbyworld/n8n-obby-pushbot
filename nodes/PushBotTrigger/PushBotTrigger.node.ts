import { randomBytes } from 'crypto';
import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IHookFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';

import { buildCommandList } from '../shared/botCmds';
import {
	BotStatus,
	BotTransport,
	CommandContext,
	CommandOptionType,
	HEADER_EVENT,
	HEADER_SIGNATURE,
	PushBotEvent,
	RestPath,
	RpcMethod,
} from '../shared/constants';
import { verifyWebhookSignature } from '../shared/signature';
import { getObbyCredentials, loadSecrets, saveSecrets } from '../shared/state';
import { PushBotRpcError, rpcCall, restRequest } from '../shared/transport';
import type { BotObj, BotSecrets, RegisterResult } from '../shared/types';

/** Event type → output index for the node's named outputs. */
const OUTPUT_INDEX: Record<string, number> = {
	[PushBotEvent.CommandInvoke]: 0,
	[PushBotEvent.MessageCreate]: 1,
	[PushBotEvent.ChannelJoin]: 2,
	[PushBotEvent.ChannelPart]: 3,
	[PushBotEvent.ChannelKick]: 4,
	[PushBotEvent.WorkflowAction]: 5,
	[PushBotEvent.Ready]: 6,
	[PushBotEvent.Resumed]: 6,
	[PushBotEvent.CommandsRegistered]: 6,
};
const OUTPUT_COUNT = 7;

/** Map an event to the value the user subscribes to in the "Events" multiOptions. */
function subscriptionKey(t: string): string {
	if (t === PushBotEvent.Resumed || t === PushBotEvent.CommandsRegistered) return PushBotEvent.Ready;
	return t;
}

/**
 * PushBot Event — the one node the user drops on the canvas to "be a bot".
 *
 * On activate it registers the bot (transport=webhook) pointed at this node's
 * own n8n webhook URL, stashes {bot_id, token, webhook_secret} in workflow
 * static data, and publishes the configured slash-command schema. On every
 * inbound POST it verifies X-PushBot-Signature against the raw body (silent
 * 401 on mismatch) and routes the event by `t` to a named output.
 *
 * Every delivery is acked 200 immediately; the reply to a COMMAND_INVOKE is
 * sent out-of-band by a downstream "PushBot Respond" action (REST
 * /interactions/<id>/respond) within the 3s ack window, or after a Defer /
 * workflow-start ack for slow work. (An inline reply in the 200 body is a
 * future opt-in; it needs responseMode 'responseNode' so a downstream node
 * can author the body.)
 */
export class PushBotTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'obbyircd PushBot Event',
		name: 'pushBotTrigger',
		icon: 'file:obby.png',
		group: ['trigger'],
		version: 1,
		subtitle: '={{ "webhook: " + $parameter["path"] }}',
		description: 'Register an obbyircd PushBot and receive its events (slash commands, messages, joins…)',
		defaults: {
			name: 'PushBot Event',
		},
		inputs: [],
		outputs: [
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
			NodeConnectionTypes.Main,
		],
		outputNames: [
			'Command Invoke',
			'Message',
			'Channel Join',
			'Channel Part',
			'Channel Kick',
			'Workflow Action',
			'Lifecycle',
		],
		credentials: [
			{
				name: 'obbyircdPushBotApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				// We ack every delivery 200 ourselves from the webhook handler and reply
				// out-of-band via REST, so n8n needn't wait on a response node.
				responseMode: 'onReceived',
				path: '={{$parameter["path"]}}',
			},
		],
		properties: [
			{
				displayName:
					'On activation this node registers the bot on the obbyircd server (transport=webhook), stores its token in this workflow\'s static data, and publishes the slash commands below. You only need the credential.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Webhook Path',
				name: 'path',
				type: 'string',
				default: 'pushbot',
				description:
					'Path segment for this node\'s public webhook URL. The full URL is registered with the IRCd automatically.',
			},

			// --- Registration options ------------------------------------------------
			{
				displayName: 'Registration',
				name: 'registration',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Real Name',
						name: 'realname',
						type: 'string',
						default: '',
						description: 'GECOS / realname for the bot. Defaults to the bot nick.',
					},
					{
						displayName: 'Scope',
						name: 'scope',
						type: 'options',
						default: 'channel',
						options: [
							{ name: 'Channel Bot', value: 'channel' },
							{ name: 'Server-Wide Bot', value: 'server' },
						],
					},
					{
						displayName: 'Auto-Join Channels',
						name: 'autoJoin',
						type: 'string',
						default: '',
						placeholder: '#general, #weather',
						description: 'Comma-separated channels the bot joins after registration.',
					},
				],
			},

			// --- Event subscription --------------------------------------------------
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				default: [PushBotEvent.CommandInvoke, PushBotEvent.MessageCreate],
				description: 'Which event types to emit. Unsubscribed events are acked 200 and dropped.',
				options: [
					{ name: 'Slash Command Invoked', value: PushBotEvent.CommandInvoke },
					{ name: 'Message (Channel / DM / TAGMSG)', value: PushBotEvent.MessageCreate },
					{ name: 'Channel Join', value: PushBotEvent.ChannelJoin },
					{ name: 'Channel Part', value: PushBotEvent.ChannelPart },
					{ name: 'Channel Kick', value: PushBotEvent.ChannelKick },
					{ name: 'Workflow Action', value: PushBotEvent.WorkflowAction },
					{ name: 'Ready / Resumed', value: PushBotEvent.Ready },
				],
			},

			// --- Slash command schema (the "workshop" surface) -----------------------
			{
				displayName: 'Slash Commands',
				name: 'commands',
				placeholder: 'Add Command',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true, sortable: true },
				default: {},
				description: 'Commands published to the server on activation. Each becomes a /name the bot answers.',
				options: [
					{
						name: 'command',
						displayName: 'Command',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								placeholder: 'weather',
								description: 'Command name without prefix. Matched case-insensitively.',
							},
							{
								displayName: 'Description',
								name: 'description',
								type: 'string',
								default: '',
								description: 'Short human-readable description (≤100 chars).',
							},
							{
								displayName: 'Contexts',
								name: 'contexts',
								type: 'multiOptions',
								default: [CommandContext.Public],
								options: [
									{ name: 'Public (in-channel, visible)', value: CommandContext.Public },
									{ name: 'Private (in-channel, whispered)', value: CommandContext.Private },
									{ name: 'PM (direct message)', value: CommandContext.Pm },
								],
							},
							{
								displayName: 'Options',
								name: 'options',
								type: 'fixedCollection',
								typeOptions: { multipleValues: true, sortable: true },
								default: {},
								options: [
									{
										name: 'option',
										displayName: 'Option',
										values: [
											{ displayName: 'Name', name: 'name', type: 'string', default: '' },
											{
												displayName: 'Type',
												name: 'type',
												type: 'options',
												default: CommandOptionType.String,
												options: [
													{ name: 'String', value: CommandOptionType.String },
													{ name: 'Integer', value: CommandOptionType.Int },
													{ name: 'Boolean', value: CommandOptionType.Bool },
													{ name: 'User', value: CommandOptionType.User },
													{ name: 'Channel', value: CommandOptionType.Channel },
												],
											},
											{ displayName: 'Required', name: 'required', type: 'boolean', default: false },
											{ displayName: 'Description', name: 'description', type: 'string', default: '' },
											{
												displayName: 'Choices',
												name: 'choices',
												type: 'string',
												default: '',
												placeholder: 'london, berlin, tokyo',
												description: 'Comma-separated. If set, the supplied value must be one of these.',
											},
										],
									},
								],
							},
							{
								displayName: 'Requires',
								name: 'requires',
								type: 'collection',
								placeholder: 'Add Requirement',
								default: {},
								options: [
									{ displayName: 'Account (Logged In)', name: 'account', type: 'boolean', default: false },
									{ displayName: 'TLS', name: 'tls', type: 'boolean', default: false },
									{
										displayName: 'Minimum Channel Rank',
										name: 'min-channel-rank',
										type: 'options',
										default: 'voice',
										options: [
											{ name: 'Voice', value: 'voice' },
											{ name: 'Halfop', value: 'halfop' },
											{ name: 'Op', value: 'op' },
											{ name: 'Admin', value: 'admin' },
											{ name: 'Owner', value: 'owner' },
										],
									},
								],
							},
						],
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			/**
			 * Always returns false so `create` runs on every (re)activation. `create`
			 * is idempotent: it reuses the existing token (no rotation) and just
			 * re-publishes the command list, which is what we want on a workflow save.
			 */
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const creds = await getObbyCredentials(this);
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'Could not determine the webhook URL for this node.');
				}

				// Detect an existing bot with this nick.
				let existing: BotObj | undefined;
				try {
					existing = await rpcCall<BotObj>(this, creds, RpcMethod.Get, { nick: creds.botNick });
				} catch (error) {
					if (!(error instanceof PushBotRpcError)) throw error;
					existing = undefined; // NOT_FOUND → needs registration
				}

				if (existing?.from_config) {
					throw new NodeOperationError(
						this.getNode(),
						`Bot "${creds.botNick}" is defined in obbyircd.conf and can't be managed over RPC. Use a different nick, or have the operator remove the pushbot { bot "${creds.botNick}" } block.`,
					);
				}

				const stored = loadSecrets(this, creds);
				let secrets: BotSecrets;

				if (existing && stored?.token && existing.webhook_url === webhookUrl) {
					// Already ours and already pointed here — reuse, don't rotate the token.
					secrets = stored;
				} else {
					if (existing) {
						// Exists but isn't ours / points elsewhere → delete then re-register
						// (the IRCd has no in-place update RPC).
						await rpcCall(this, creds, RpcMethod.Delete, { nick: creds.botNick });
					}
					const reg = this.getNodeParameter('registration', {}) as IDataObject;
					const webhookSecret = randomBytes(32).toString('hex');
					let result: RegisterResult;
					try {
						result = await rpcCall<RegisterResult>(this, creds, RpcMethod.Register, {
							nick: creds.botNick,
							transport: BotTransport.Webhook,
							webhook_url: webhookUrl,
							webhook_secret: webhookSecret,
							...(reg.scope ? { scope: reg.scope } : {}),
							...(reg.realname ? { realname: reg.realname } : {}),
						});
					} catch (error) {
						if (error instanceof PushBotRpcError && error.code === 'DENIED') {
							throw new NodeOperationError(
								this.getNode(),
								'Registration denied: the server is in pushbot::mode "admin". Ask the operator to set mode to "approval" or "open", or to define the bot in obbyircd.conf.',
							);
						}
						throw error;
					}
					secrets = {
						bot_id: result.bot_id,
						token: result.token,
						webhook_secret: webhookSecret,
						webhook_url: webhookUrl,
						status: result.status,
					};
					saveSecrets(this, creds, secrets);
				}

				if (secrets.status === BotStatus.Pending) {
					this.logger?.warn(
						`PushBot "${creds.botNick}" registered but PENDING approval — an IRC operator must run /PUSHBOT APPROVE ${creds.botNick} before events are delivered.`,
					);
				}

				// Publish slash commands + auto-join (best-effort; only meaningful once active).
				if (secrets.status === BotStatus.Active) {
					const list = buildCommandList(this.getNodeParameter('commands', {}) as IDataObject);
					if (list.commands.length) {
						await restRequest(this, creds, secrets.token, 'POST', RestPath.commands(), {
							commands: list.commands,
						} as unknown as IDataObject);
					}
					const reg = this.getNodeParameter('registration', {}) as IDataObject;
					const autoJoin = String(reg.autoJoin ?? '')
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean);
					for (const chan of autoJoin) {
						await restRequest(this, creds, secrets.token, 'POST', RestPath.channelJoin(chan), {});
					}
				}
				return true;
			},

			/**
			 * Deliberately does NOT delete the remote bot: n8n calls this on every
			 * deactivate/save, and we don't want to rotate the token or orphan
			 * channels each time. The bot persists; retire it with the PushBot
			 * "Delete" action when you actually mean it.
			 */
			async delete(this: IHookFunctions): Promise<boolean> {
				const creds = await getObbyCredentials(this);
				this.logger?.info(
					`PushBot "${creds.botNick}" webhook deactivated; the bot remains registered (use the Delete action to retire it).`,
				);
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const res = this.getResponseObject();
		const creds = await getObbyCredentials(this);
		const secrets = loadSecrets(this, creds);

		// 1. Verify the signature against the RAW body bytes (no re-serialisation).
		const req = this.getRequestObject();
		const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
		const headers = this.getHeaderData() as IDataObject;
		const signature = headers[HEADER_SIGNATURE] as string | undefined;
		if (!secrets?.webhook_secret || !rawBody || !verifyWebhookSignature(rawBody, secrets.webhook_secret, signature)) {
			res.status(401).end();
			return { noWebhookResponse: true };
		}

		// 2. Parse the {op,t,s,d} frame.
		let frame: { t?: string; s?: number; d?: IDataObject };
		try {
			frame = JSON.parse(rawBody.toString('utf8'));
		} catch {
			res.status(400).end();
			return { noWebhookResponse: true };
		}
		const t = String(frame.t ?? headers[HEADER_EVENT] ?? '');
		const d = (frame.d ?? {}) as IDataObject;

		// 3. Drop events the user hasn't subscribed to (ack 200, don't run the workflow).
		const subscribed = (this.getNodeParameter('events', []) as string[]) ?? [];
		if (!(t in OUTPUT_INDEX) || !subscribed.includes(subscriptionKey(t))) {
			res.status(200).end();
			return { noWebhookResponse: true };
		}

		// 4. Route the event to its named output. `d` is spread to the top level so
		//    expressions like {{$json.id}}, {{$json.channel}}, {{$json.name}} just work.
		const outputs: INodeExecutionData[][] = Array.from({ length: OUTPUT_COUNT }, () => [] as INodeExecutionData[]);
		outputs[OUTPUT_INDEX[t]] = [{ json: { ...d, event: t, seq: frame.s } }];

		// 5. Ack 200 immediately and run the workflow in the background. A reply to a
		//    COMMAND_INVOKE is sent out-of-band by a downstream "PushBot Respond"
		//    action via POST /interactions/<id>/respond — within the 3s window for a
		//    fast reply, or after a Defer / workflow-start ack for a slow one.
		res.status(200).end();
		return { noWebhookResponse: true, workflowData: outputs };
	}
}
