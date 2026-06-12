/**
 * PushBot protocol constants — single source of truth for the wire model.
 *
 * Every value here is taken from the deployed IRCd module
 * (references/code/pushbot.c, ~5500 lines). When the spec and the code
 * disagree, the code wins; these constants follow the code.
 *
 * The n8n plugin only ever uses transport=webhook: the IRCd POSTs each
 * event to our webhook URL, and we answer either inline (in the 200 body
 * of a COMMAND_INVOKE) or out-of-band via the Bearer REST API.
 */

/** REST base path on the obbyircd RPC/TLS listener. */
export const REST_BASE = '/pushbot/v1';

/** JSON-RPC endpoint on the same listener (rpc-user auth, class `full`). */
export const RPC_PATH = '/api';

/** Default port carrying `options { rpc; tls; }`. */
export const DEFAULT_PORT = 8600;

/**
 * Webhook headers the IRCd sends on every delivery (pb_webhook_fire).
 * NOTE: there is NO X-PushBot-Timestamp — the signature is over the raw
 * body only, so no replay window is encoded in the HMAC.
 */
export const HEADER_EVENT = 'x-pushbot-event';
export const HEADER_BOT = 'x-pushbot-bot';
export const HEADER_SIGNATURE = 'x-pushbot-signature';
export const SIGNATURE_PREFIX = 'sha256=';

/**
 * Inbound event types (the `t` field of the {op,t,s,d} frame, mirrored in
 * the X-PushBot-Event header). Only these are emitted by the current code.
 * Spec-only events (REACTION_ADD, MESSAGE_DELETE, USER_NICK_CHANGE, …) are
 * NOT delivered and intentionally absent.
 */
export enum PushBotEvent {
	Ready = 'READY',
	Resumed = 'RESUMED',
	CommandsRegistered = 'COMMANDS_REGISTERED',
	CommandInvoke = 'COMMAND_INVOKE',
	MessageCreate = 'MESSAGE_CREATE',
	ChannelJoin = 'CHANNEL_JOIN',
	ChannelPart = 'CHANNEL_PART',
	ChannelKick = 'CHANNEL_KICK',
	WorkflowAction = 'WORKFLOW_ACTION',
}

/**
 * Inline-action `type` values the IRCd parses out of a COMMAND_INVOKE
 * webhook's 200 response body (pb_webhook_dispatch_inline_action). Parsed
 * ONLY for COMMAND_INVOKE; the iid is recovered server-side from the
 * request's `d.id`, so the response body never repeats it.
 */
export enum InlineActionType {
	SendMessage = 'send_message',
	EphemeralReply = 'ephemeral_reply',
	Error = 'error',
	Defer = 'defer',
	Workflow = 'workflow',
	Step = 'step',
}

/** Slash-command invocation contexts (bot-cmds command schema). */
export enum CommandContext {
	Public = 'public',
	Private = 'private',
	Pm = 'pm',
}

/** Slash-command option types (bot-cmds). Code coerces string/int/bool; user/channel ride as strings. */
export enum CommandOptionType {
	String = 'string',
	Int = 'int',
	Bool = 'bool',
	User = 'user',
	Channel = 'channel',
}

/** `+draft/bot-cmd-error` codes (plain token, not base64). */
export enum CommandErrorCode {
	InvalidCommand = 'INVALID_COMMAND',
	InvalidOptions = 'INVALID_OPTIONS',
	BadContext = 'BAD_CONTEXT',
	NotPermitted = 'NOT_PERMITTED',
}

/** +draft/bot-tools workflow lifecycle states. */
export enum WorkflowState {
	Start = 'start',
	Reasoning = 'reasoning',
	Running = 'running',
	Complete = 'complete',
	Failed = 'failed',
	Cancelled = 'cancelled',
}

/** +draft/bot-tools step types and states. */
export enum StepType {
	Reasoning = 'reasoning',
	ToolCall = 'tool-call',
	ToolResult = 'tool-result',
	Text = 'text',
}
export enum StepState {
	Start = 'start',
	Running = 'running',
	PendingApproval = 'pending-approval',
	Complete = 'complete',
	Failed = 'failed',
	Cancelled = 'cancelled',
}

/** JSON-RPC pushbot.* methods that actually exist (control plane). */
export enum RpcMethod {
	List = 'pushbot.list',
	Get = 'pushbot.get',
	Register = 'pushbot.register',
	Approve = 'pushbot.approve',
	Suspend = 'pushbot.suspend',
	Unsuspend = 'pushbot.unsuspend',
	Delete = 'pushbot.delete',
}

/** RPC error codes the IRCd can return. */
export enum RpcError {
	NotFound = 'NOT_FOUND',
	Denied = 'DENIED',
	AlreadyExists = 'ALREADY_EXISTS',
	InternalError = 'INTERNAL_ERROR',
}

/** Bot transports. The plugin always registers `webhook`. */
export enum BotTransport {
	Gateway = 'gateway',
	Webhook = 'webhook',
	Both = 'both',
}

export enum BotScope {
	Channel = 'channel',
	Server = 'server',
}

/** Registration / status lifecycle values. */
export enum BotStatus {
	Pending = 'pending',
	Active = 'active',
	Suspended = 'suspended',
	Deleted = 'deleted',
}

/**
 * REST path builders. Channel names must be percent-encoded (`#` → `%23`);
 * the helpers below assume the caller passes a raw name and encode here.
 */
export const RestPath = {
	bot: () => `${REST_BASE}/bot`,
	channels: () => `${REST_BASE}/channels`,
	channelMembers: (chan: string) => `${REST_BASE}/channels/${enc(chan)}/members`,
	channelMessages: (chan: string) => `${REST_BASE}/channels/${enc(chan)}/messages`,
	channelJoin: (chan: string) => `${REST_BASE}/channels/${enc(chan)}/join`,
	channelPart: (chan: string) => `${REST_BASE}/channels/${enc(chan)}/part`,
	messageReact: (chan: string, msgid: string) =>
		`${REST_BASE}/channels/${enc(chan)}/messages/${enc(msgid)}/react`,
	messageUnreact: (chan: string, msgid: string) =>
		`${REST_BASE}/channels/${enc(chan)}/messages/${enc(msgid)}/unreact`,
	messageRedact: (chan: string, msgid: string) =>
		`${REST_BASE}/channels/${enc(chan)}/messages/${enc(msgid)}/redact`,
	userMessages: (nick: string) => `${REST_BASE}/users/${enc(nick)}/messages`,
	commands: () => `${REST_BASE}/commands`,
	interactionRespond: (id: string) => `${REST_BASE}/interactions/${enc(id)}/respond`,
	interactionDefer: (id: string) => `${REST_BASE}/interactions/${enc(id)}/defer`,
	workflowEvents: (wid: string) => `${REST_BASE}/workflows/${enc(wid)}/events`,
};

function enc(s: string): string {
	return encodeURIComponent(s);
}
