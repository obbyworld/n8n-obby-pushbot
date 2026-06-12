import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { stepPayload, workflowPayload } from '../shared/botTools';
import {
	CommandErrorCode,
	RestPath,
	RpcMethod,
	StepState,
	StepType,
	WorkflowState,
} from '../shared/constants';
import { clearSecrets, getObbyCredentials, loadSecrets, type ObbyCredentials } from '../shared/state';
import { rpcCall, restRequest } from '../shared/transport';
import type { BotToolsStep, BotToolsWorkflow } from '../shared/types';

/**
 * PushBot Respond / Send / Manage — every spontaneous verb the bot needs.
 *
 * Resources:
 *   - Interaction : answer / defer / error a COMMAND_INVOKE (fast inline OR slow REST).
 *   - Workflow    : stream +draft/bot-tools progress to a channel.
 *   - Message     : spontaneous channel msg, DM, react, redact, join, part.
 *   - Bot         : control-plane lifecycle over JSON-RPC.
 *
 * The interaction `id`, channel, etc. flow in from the Trigger node's output
 * via expressions, so the user never types an id or a token.
 *
 * SKELETON: `description` is final and reviewable; `execute` is stubbed.
 */
export class PushBotAction implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Obby PushBot Action',
		name: 'pushBotAction',
		icon: 'file:obby.png',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Reply to slash commands, stream workflow progress, send messages, and manage the bot',
		defaults: {
			name: 'PushBot Action',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'obbyircdPushBotApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'interaction',
				options: [
					{ name: 'Interaction', value: 'interaction' },
					{ name: 'Workflow', value: 'workflow' },
					{ name: 'Message', value: 'message' },
					{ name: 'Bot', value: 'bot' },
				],
			},

			// ============================ INTERACTION ============================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['interaction'] } },
				default: 'respond',
				options: [
					{ name: 'Respond', value: 'respond', action: 'Respond to a slash command', description: 'Send the final reply (inline fast-path or REST slow-path)' },
					{ name: 'Defer', value: 'defer', action: 'Defer a slash command', description: 'Extend the ack window without a full workflow' },
					{ name: 'Send Error', value: 'error', action: 'Reject a slash command', description: 'Reply with a bot-cmd-error code' },
				],
			},
			{
				displayName: 'Interaction ID',
				name: 'interactionId',
				type: 'string',
				default: '={{ $json.id }}',
				required: true,
				displayOptions: { show: { resource: ['interaction'] } },
				description: 'The COMMAND_INVOKE interaction id, normally piped from the Trigger.',
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				displayOptions: { show: { resource: ['interaction'], operation: ['respond'] } },
			},
			{
				displayName: 'Visibility',
				name: 'visibility',
				type: 'options',
				default: 'public',
				options: [
					{ name: 'Public', value: 'public' },
					{ name: 'Private', value: 'private' },
				],
				displayOptions: { show: { resource: ['interaction'], operation: ['respond'] } },
			},
			{
				displayName: 'Ephemeral',
				name: 'ephemeral',
				type: 'boolean',
				default: false,
				displayOptions: { show: { resource: ['interaction'], operation: ['respond'] } },
			},
			{
				displayName: 'Delivery',
				name: 'delivery',
				type: 'options',
				default: 'auto',
				options: [
					{ name: 'Auto', value: 'auto', description: 'Inline if this is the webhook response and the workflow is still within the ack window; otherwise REST.' },
					{ name: 'Inline (Webhook Reply)', value: 'inline', description: 'Return the action in the COMMAND_INVOKE 200 body. Requires the Trigger in "Use a Respond Node" mode.' },
					{ name: 'REST (Out-of-Band)', value: 'rest', description: 'POST /interactions/<id>/respond. Use after slow work.' },
				],
				displayOptions: { show: { resource: ['interaction'], operation: ['respond'] } },
			},
			{
				displayName: 'Defer Seconds',
				name: 'seconds',
				type: 'number',
				default: 15,
				displayOptions: { show: { resource: ['interaction'], operation: ['defer'] } },
			},
			{
				displayName: 'Error Code',
				name: 'errorCode',
				type: 'options',
				default: CommandErrorCode.InvalidOptions,
				options: [
					{ name: 'Invalid Command', value: CommandErrorCode.InvalidCommand },
					{ name: 'Invalid Options', value: CommandErrorCode.InvalidOptions },
					{ name: 'Bad Context', value: CommandErrorCode.BadContext },
					{ name: 'Not Permitted', value: CommandErrorCode.NotPermitted },
				],
				displayOptions: { show: { resource: ['interaction'], operation: ['error'] } },
			},
			{
				displayName: 'Message',
				name: 'errorMessage',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['interaction'], operation: ['error'] } },
			},

			// ============================ WORKFLOW ============================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['workflow'] } },
				default: 'start',
				options: [
					{ name: 'Start', value: 'start', action: 'Start a workflow' },
					{ name: 'Emit Step', value: 'step', action: 'Emit a workflow step' },
					{ name: 'Complete', value: 'complete', action: 'Complete a workflow' },
					{ name: 'Fail', value: 'fail', action: 'Fail a workflow' },
					{ name: 'Cancel', value: 'cancel', action: 'Cancel a workflow' },
					{ name: 'Request Approval', value: 'requestApproval', action: 'Pause a step for approval' },
					{ name: 'Request Input', value: 'requestInput', action: 'Request input mid-workflow' },
				],
			},
			{
				displayName: 'Target',
				name: 'target',
				type: 'string',
				default: '={{ $json.channel }}',
				displayOptions: { show: { resource: ['workflow'] } },
				description: 'Channel or nick the +draft/bot-tools tags are sent to.',
			},
			{
				displayName: 'Workflow ID',
				name: 'wid',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['workflow'] } },
				description: 'Opaque workflow id, unique per bot. Reuse the same id across start → steps → complete.',
			},
			{
				displayName: 'Name',
				name: 'workflowName',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['workflow'], operation: ['start'] } },
			},
			{
				displayName: 'Features',
				name: 'features',
				type: 'multiOptions',
				default: [],
				options: [
					{ name: 'Interactive', value: 'interactive' },
					{ name: 'Reasoning', value: 'reasoning' },
					{ name: 'Approval', value: 'approval' },
				],
				displayOptions: { show: { resource: ['workflow'], operation: ['start'] } },
			},
			{
				displayName: 'Step ID',
				name: 'sid',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['workflow'], operation: ['step', 'requestApproval'] } },
			},
			{
				displayName: 'Step Type',
				name: 'stepType',
				type: 'options',
				default: StepType.ToolCall,
				options: [
					{ name: 'Reasoning', value: StepType.Reasoning },
					{ name: 'Tool Call', value: StepType.ToolCall },
					{ name: 'Tool Result', value: StepType.ToolResult },
					{ name: 'Text', value: StepType.Text },
				],
				displayOptions: { show: { resource: ['workflow'], operation: ['step'] } },
			},
			{
				displayName: 'Step State',
				name: 'stepState',
				type: 'options',
				default: StepState.Start,
				options: [
					{ name: 'Start', value: StepState.Start },
					{ name: 'Running', value: StepState.Running },
					{ name: 'Complete', value: StepState.Complete },
					{ name: 'Failed', value: StepState.Failed },
				],
				displayOptions: { show: { resource: ['workflow'], operation: ['step'] } },
			},
			{
				displayName: 'Tool / Label / Content',
				name: 'stepDetails',
				type: 'collection',
				placeholder: 'Add Detail',
				default: {},
				displayOptions: { show: { resource: ['workflow'], operation: ['step'] } },
				options: [
					{ displayName: 'Tool', name: 'tool', type: 'string', default: '', placeholder: 'web-search' },
					{ displayName: 'Label', name: 'label', type: 'string', default: '' },
					{ displayName: 'Content (JSON for tool-call, string otherwise)', name: 'content', type: 'json', default: '' },
				],
			},

			// ============================ MESSAGE ============================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['message'] } },
				default: 'sendChannel',
				options: [
					{ name: 'Send to Channel', value: 'sendChannel', action: 'Send a channel message' },
					{ name: 'Send DM', value: 'sendDm', action: 'Send a direct message' },
					{ name: 'React', value: 'react', action: 'React to a message' },
					{ name: 'Unreact', value: 'unreact', action: 'Remove a reaction' },
					{ name: 'Redact', value: 'redact', action: 'Redact a message' },
					{ name: 'Join Channel', value: 'join', action: 'Join a channel' },
					{ name: 'Part Channel', value: 'part', action: 'Part a channel' },
				],
			},
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'string',
				default: '',
				placeholder: '#general',
				displayOptions: { show: { resource: ['message'], operation: ['sendChannel', 'react', 'unreact', 'redact', 'join', 'part'] } },
			},
			{
				displayName: 'Nick',
				name: 'nick',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['sendDm'] } },
			},
			{
				displayName: 'Content',
				name: 'content',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['sendChannel', 'sendDm'] } },
			},
			{
				displayName: 'Message ID',
				name: 'msgid',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['message'], operation: ['react', 'unreact', 'redact'] } },
			},
			{
				displayName: 'Emoji',
				name: 'emoji',
				type: 'string',
				default: '',
				placeholder: '+1',
				displayOptions: { show: { resource: ['message'], operation: ['react', 'unreact'] } },
			},

			// ============================ BOT (control plane) ============================
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['bot'] } },
				default: 'get',
				options: [
					{ name: 'Approve', value: 'approve', action: 'Approve a pending bot' },
					{ name: 'Suspend', value: 'suspend', action: 'Suspend the bot' },
					{ name: 'Unsuspend', value: 'unsuspend', action: 'Unsuspend the bot' },
					{ name: 'Delete', value: 'delete', action: 'Delete the bot' },
					{ name: 'List', value: 'list', action: 'List bots' },
					{ name: 'Get', value: 'get', action: 'Get the bot' },
					{ name: 'Get Own State', value: 'getSelf', action: 'Get the bot\'s REST profile' },
					{ name: 'List Channels', value: 'listChannels', action: 'List the bot\'s channels' },
					{ name: 'List Members', value: 'listMembers', action: 'List channel members' },
				],
			},
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'string',
				default: '',
				placeholder: '#general',
				displayOptions: { show: { resource: ['bot'], operation: ['listMembers'] } },
			},
			{
				displayName:
					'Registration (and token rotation) is handled by the PushBot Event trigger, which owns the webhook URL. To rotate the token, run Delete here, then re-activate the trigger.',
				name: 'lifecycleNote',
				type: 'notice',
				default: '',
				displayOptions: { show: { resource: ['bot'], operation: ['delete'] } },
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const creds = await getObbyCredentials(this);
		const out: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;
			try {
				const result = await runOperation(this, creds, resource, operation, i);
				out.push({ json: result, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw error;
			}
		}
		return [out];
	}
}

// ---------------------------------------------------------------------------
// Operation dispatch (module-level: `this` inside execute is IExecuteFunctions,
// not the node instance, so helpers take the context explicitly).
// ---------------------------------------------------------------------------

async function runOperation(
	ctx: IExecuteFunctions,
	creds: ObbyCredentials,
	resource: string,
	operation: string,
	i: number,
): Promise<IDataObject> {
	switch (resource) {
		case 'interaction':
			return interactionOp(ctx, creds, operation, i);
		case 'workflow':
			return workflowOp(ctx, creds, operation, i);
		case 'message':
			return messageOp(ctx, creds, operation, i);
		case 'bot':
			return botOp(ctx, creds, operation, i);
		default:
			throw new NodeOperationError(ctx.getNode(), `Unknown resource: ${resource}`);
	}
}

function requireToken(ctx: IExecuteFunctions, creds: ObbyCredentials): string {
	const secrets = loadSecrets(ctx, creds);
	if (!secrets?.token) {
		throw new NodeOperationError(
			ctx.getNode(),
			`No token stored for bot "${creds.botNick}". Activate the PushBot Event trigger to register it first.`,
		);
	}
	return secrets.token;
}

async function interactionOp(
	ctx: IExecuteFunctions,
	creds: ObbyCredentials,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const token = requireToken(ctx, creds);
	const id = ctx.getNodeParameter('interactionId', i) as string;

	if (operation === 'respond') {
		const body: IDataObject = {
			content: ctx.getNodeParameter('content', i, '') as string,
			visibility: ctx.getNodeParameter('visibility', i, 'public') as string,
			ephemeral: ctx.getNodeParameter('ephemeral', i, false) as boolean,
		};
		return restRequest(ctx, creds, token, 'POST', RestPath.interactionRespond(id), body);
	}
	if (operation === 'defer') {
		const seconds = ctx.getNodeParameter('seconds', i, 15) as number;
		return restRequest(ctx, creds, token, 'POST', RestPath.interactionDefer(id), { seconds });
	}
	if (operation === 'error') {
		// No dedicated error endpoint: reply ephemerally and carry the code as a tag.
		const code = ctx.getNodeParameter('errorCode', i) as string;
		const message = (ctx.getNodeParameter('errorMessage', i, '') as string) || code;
		const body: IDataObject = {
			content: message,
			visibility: 'public',
			ephemeral: true,
			tags: { '+draft/bot-cmd-error': code },
		};
		return restRequest(ctx, creds, token, 'POST', RestPath.interactionRespond(id), body);
	}
	throw new NodeOperationError(ctx.getNode(), `Unknown interaction operation: ${operation}`);
}

async function workflowOp(
	ctx: IExecuteFunctions,
	creds: ObbyCredentials,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const token = requireToken(ctx, creds);
	const target = ctx.getNodeParameter('target', i) as string;
	const wid = ctx.getNodeParameter('wid', i) as string;
	let payload: BotToolsWorkflow | BotToolsStep;

	switch (operation) {
		case 'start':
			payload = workflowPayload({
				id: wid,
				state: WorkflowState.Start,
				name: (ctx.getNodeParameter('workflowName', i, '') as string) || undefined,
				features: ctx.getNodeParameter('features', i, []) as Array<'interactive' | 'reasoning' | 'approval'>,
			});
			break;
		case 'complete':
			payload = workflowPayload({ id: wid, state: WorkflowState.Complete });
			break;
		case 'fail':
			payload = workflowPayload({ id: wid, state: WorkflowState.Failed });
			break;
		case 'cancel':
			payload = workflowPayload({ id: wid, state: WorkflowState.Cancelled });
			break;
		case 'step': {
			const details = ctx.getNodeParameter('stepDetails', i, {}) as IDataObject;
			payload = stepPayload({
				wid,
				sid: ctx.getNodeParameter('sid', i) as string,
				type: ctx.getNodeParameter('stepType', i) as StepType,
				state: ctx.getNodeParameter('stepState', i) as StepState,
				tool: details.tool ? String(details.tool) : undefined,
				label: details.label ? String(details.label) : undefined,
				content: parseMaybeJson(details.content),
			});
			break;
		}
		case 'requestApproval':
			payload = stepPayload({
				wid,
				sid: ctx.getNodeParameter('sid', i) as string,
				type: StepType.ToolCall,
				state: StepState.PendingApproval,
			});
			break;
		case 'requestInput':
			// Keep the workflow alive while awaiting the client's `input` action,
			// which arrives on the trigger's "Workflow Action" output.
			payload = workflowPayload({ id: wid, state: WorkflowState.Running, features: ['interactive'] });
			break;
		default:
			throw new NodeOperationError(ctx.getNode(), `Unknown workflow operation: ${operation}`);
	}

	return restRequest(ctx, creds, token, 'POST', RestPath.workflowEvents(wid), {
		target,
		payload,
	} as unknown as IDataObject);
}

async function messageOp(
	ctx: IExecuteFunctions,
	creds: ObbyCredentials,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const token = requireToken(ctx, creds);

	switch (operation) {
		case 'sendChannel': {
			const channel = ctx.getNodeParameter('channel', i) as string;
			const content = ctx.getNodeParameter('content', i, '') as string;
			return restRequest(ctx, creds, token, 'POST', RestPath.channelMessages(channel), { content });
		}
		case 'sendDm': {
			const nick = ctx.getNodeParameter('nick', i) as string;
			const content = ctx.getNodeParameter('content', i, '') as string;
			return restRequest(ctx, creds, token, 'POST', RestPath.userMessages(nick), { content });
		}
		case 'react': {
			const channel = ctx.getNodeParameter('channel', i) as string;
			const msgid = ctx.getNodeParameter('msgid', i) as string;
			const emoji = ctx.getNodeParameter('emoji', i) as string;
			return restRequest(ctx, creds, token, 'POST', RestPath.messageReact(channel, msgid), { emoji });
		}
		case 'unreact': {
			const channel = ctx.getNodeParameter('channel', i) as string;
			const msgid = ctx.getNodeParameter('msgid', i) as string;
			const emoji = ctx.getNodeParameter('emoji', i) as string;
			return restRequest(ctx, creds, token, 'POST', RestPath.messageUnreact(channel, msgid), { emoji });
		}
		case 'redact': {
			const channel = ctx.getNodeParameter('channel', i) as string;
			const msgid = ctx.getNodeParameter('msgid', i) as string;
			return restRequest(ctx, creds, token, 'POST', RestPath.messageRedact(channel, msgid), {});
		}
		case 'join': {
			const channel = ctx.getNodeParameter('channel', i) as string;
			return restRequest(ctx, creds, token, 'POST', RestPath.channelJoin(channel), {});
		}
		case 'part': {
			const channel = ctx.getNodeParameter('channel', i) as string;
			return restRequest(ctx, creds, token, 'POST', RestPath.channelPart(channel), {});
		}
		default:
			throw new NodeOperationError(ctx.getNode(), `Unknown message operation: ${operation}`);
	}
}

async function botOp(
	ctx: IExecuteFunctions,
	creds: ObbyCredentials,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const nick = creds.botNick;

	switch (operation) {
		case 'list':
			return rpcCall(ctx, creds, RpcMethod.List);
		case 'get':
			return rpcCall(ctx, creds, RpcMethod.Get, { nick });
		case 'approve':
			return rpcCall(ctx, creds, RpcMethod.Approve, { nick });
		case 'suspend':
			return rpcCall(ctx, creds, RpcMethod.Suspend, { nick });
		case 'unsuspend':
			return rpcCall(ctx, creds, RpcMethod.Unsuspend, { nick });
		case 'delete': {
			const result = await rpcCall<IDataObject>(ctx, creds, RpcMethod.Delete, { nick });
			clearSecrets(ctx, creds);
			return result;
		}
		case 'getSelf':
			return restRequest(ctx, creds, requireToken(ctx, creds), 'GET', RestPath.bot());
		case 'listChannels':
			return restRequest(ctx, creds, requireToken(ctx, creds), 'GET', RestPath.channels());
		case 'listMembers': {
			const channel = ctx.getNodeParameter('channel', i) as string;
			return restRequest(ctx, creds, requireToken(ctx, creds), 'GET', RestPath.channelMembers(channel));
		}
		default:
			throw new NodeOperationError(ctx.getNode(), `Unknown bot operation: ${operation}`);
	}
}

function parseMaybeJson(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
}
