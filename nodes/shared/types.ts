/**
 * PushBot wire types. Field names mirror pushbot.c exactly — do not rename
 * without re-checking the C source, because these are serialised on the wire.
 */
import type {
	BotScope,
	BotStatus,
	BotTransport,
	CommandContext,
	CommandErrorCode,
	CommandOptionType,
	InlineActionType,
	PushBotEvent,
	StepState,
	StepType,
	WorkflowState,
} from './constants';

// ---------------------------------------------------------------------------
// Inbound: the {op,t,s,d} frame the IRCd POSTs to our webhook URL.
// ---------------------------------------------------------------------------

export interface DispatchFrame<TData = unknown> {
	op: 0;
	t: PushBotEvent;
	s: number;
	d: TData;
}

/** Redacted IRC client struct (pb_json_client). `ip`/`realhost`/geoip omitted unless bypass-privacy. */
export interface PushBotClient {
	nick: string;
	id: string;
	account: string;
	ident: string;
	host: string;
	is_bot: boolean;
	umodes: string;
	is_oper: boolean;
	is_secure: boolean;
	is_logged_in: boolean;
}

export interface PushBotChannelRef {
	name: string;
	topic: string;
	users_count: number;
}

export interface CommandInvokeData {
	id: string; // interaction id, e.g. "iact.<hextime>.<hexrand>"
	invoker: PushBotClient;
	channel: string | null; // null for a pm-context invocation
	invoker_msgid?: string;
	name: string;
	options: Record<string, string | number | boolean>;
}

export interface MessageCreateData {
	msgid: string;
	channel: PushBotChannelRef | null; // null ⇒ DM
	author: PushBotClient;
	content: string;
	is_notice: boolean;
	is_tagmsg: boolean;
	mention_bot?: boolean; // channel messages only
	is_dm?: boolean; // DM only
}

export interface ChannelJoinData {
	client: PushBotClient;
	channel: PushBotChannelRef;
}
export interface ChannelPartData {
	client: PushBotClient;
	channel: PushBotChannelRef;
	reason: string;
}
export interface ChannelKickData {
	client: PushBotClient; // the kicker
	victim: PushBotClient; // the kicked user
	channel: PushBotChannelRef;
	reason: string;
}

/** A client-sent +draft/bot-tools action targeting one of our workflows. */
export interface WorkflowActionData {
	wid: string;
	action: 'cancel' | 'approve' | 'reject' | 'input' | string;
	target: string;
	content?: unknown;
	from: PushBotClient;
}

export interface ReadyData {
	session_id: string;
	bot_nick: string;
	scope: BotScope;
	channels: string[];
}
export interface ResumedData {
	replayed: number;
}

// ---------------------------------------------------------------------------
// Outbound (fast path): inline action returned in the COMMAND_INVOKE 200 body.
// Parsed only for COMMAND_INVOKE; iid is recovered server-side.
// ---------------------------------------------------------------------------

export type InlineAction =
	| { type: InlineActionType.SendMessage; content: string; visibility?: 'public' | 'private'; ephemeral?: boolean; tags?: Record<string, string> }
	| { type: InlineActionType.EphemeralReply; content: string }
	| { type: InlineActionType.Error; message: string }
	| { type: InlineActionType.Defer; seconds?: number }
	| { type: InlineActionType.Workflow; state: WorkflowState; id: string; name?: string; trigger?: string; target?: string }
	| { type: InlineActionType.Step; wid: string; sid: string; state: StepState; target?: string; payload?: BotToolsStep };

// ---------------------------------------------------------------------------
// Outbound (slow path): Bearer REST bodies.
// ---------------------------------------------------------------------------

export interface InteractionRespondBody {
	content?: string;
	visibility?: 'public' | 'private';
	ephemeral?: boolean;
	tags?: Record<string, string>; // raw JSON values; server base64-encodes for the wire
}
export interface InteractionDeferBody {
	seconds?: number;
}
export interface WorkflowEventBody {
	target: string; // channel name or nick the workflow tags are sent to
	payload: BotToolsWorkflow | BotToolsStep;
}
export interface SendContentBody {
	content: string;
}
export interface ReactBody {
	emoji: string;
}

// ---------------------------------------------------------------------------
// +draft/bot-tools payloads (POSTed to /workflows/<wid>/events as `payload`).
// ---------------------------------------------------------------------------

export interface BotToolsWorkflow {
	msg: 'workflow';
	id: string;
	state: WorkflowState;
	name?: string;
	trigger?: string;
	'cancelled-by'?: string;
	features?: Array<'interactive' | 'reasoning' | 'approval'>;
}
export interface BotToolsStep {
	msg: 'step';
	wid: string;
	sid: string;
	type: StepType;
	state: StepState;
	tool?: string;
	label?: string;
	content?: unknown;
	truncated?: boolean;
	'cancelled-by'?: string;
}

// ---------------------------------------------------------------------------
// bot-cmds command schema (POSTed to /commands as { commands: [...] }).
// ---------------------------------------------------------------------------

export interface CommandOption {
	name: string;
	type: CommandOptionType;
	required?: boolean;
	description?: string;
	choices?: string[];
}
export interface CommandRequires {
	account?: boolean;
	tls?: boolean;
	'min-channel-rank'?: 'voice' | 'halfop' | 'op' | 'admin' | 'owner';
}
export interface CommandSchema {
	name: string;
	description: string;
	contexts: CommandContext[];
	options?: CommandOption[];
	requires?: CommandRequires;
}
export interface CommandList {
	prefix?: string;
	commands: CommandSchema[];
}

// ---------------------------------------------------------------------------
// JSON-RPC (control plane).
// ---------------------------------------------------------------------------

export interface BotObj {
	bot_id: string;
	nick: string;
	realname: string;
	scope: BotScope;
	transport: BotTransport;
	status: BotStatus;
	from_config: boolean;
	webhook_url: string;
	online: boolean;
	channels_count: number;
}
export interface RegisterResult {
	bot_id: string;
	token: string;
	status: BotStatus;
}
export interface RegisterParams {
	nick: string;
	realname?: string;
	scope?: BotScope;
	transport?: BotTransport; // always BotTransport.Webhook for n8n
	webhook_url?: string;
	webhook_secret?: string;
}

// ---------------------------------------------------------------------------
// Per-bot secrets minted at registration, persisted in workflow static data.
// ---------------------------------------------------------------------------

export interface BotSecrets {
	bot_id: string;
	token: string;
	webhook_secret: string;
	webhook_url: string;
	status: BotStatus;
}

export type { CommandErrorCode };
