/**
 * +draft/bot-tools payload builders for the workflow-transparency surface.
 *
 * These produce the `payload` object that goes inside a
 *   POST /pushbot/v1/workflows/<wid>/events  { target, payload }
 * call. The terminal `workflow:complete` is preferably attached to the final
 * reply's `tags` (base64) rather than sent alone.
 */
import type { StepState, StepType, WorkflowState } from './constants';
import type { BotToolsStep, BotToolsWorkflow } from './types';

/** A `{"msg":"workflow", ...}` lifecycle payload, omitting empty fields. */
export function workflowPayload(opts: {
	id: string;
	state: WorkflowState;
	name?: string;
	trigger?: string;
	cancelledBy?: string;
	features?: Array<'interactive' | 'reasoning' | 'approval'>;
}): BotToolsWorkflow {
	const payload: BotToolsWorkflow = { msg: 'workflow', id: opts.id, state: opts.state };
	if (opts.name) payload.name = opts.name;
	if (opts.trigger) payload.trigger = opts.trigger;
	if (opts.cancelledBy) payload['cancelled-by'] = opts.cancelledBy;
	if (opts.features && opts.features.length) payload.features = opts.features;
	return payload;
}

/** A `{"msg":"step", ...}` payload. `content` is native JSON for tool-call inputs. */
export function stepPayload(opts: {
	wid: string;
	sid: string;
	type: StepType;
	state: StepState;
	tool?: string;
	label?: string;
	content?: unknown;
}): BotToolsStep {
	const payload: BotToolsStep = {
		msg: 'step',
		wid: opts.wid,
		sid: opts.sid,
		type: opts.type,
		state: opts.state,
	};
	if (opts.tool) payload.tool = opts.tool;
	if (opts.label) payload.label = opts.label;
	if (opts.content !== undefined) payload.content = opts.content;
	return payload;
}

/**
 * Encode a payload as the base64-of-compact-JSON value used when a workflow
 * tag is attached to an interaction reply's `tags` map (terminal-on-reply).
 */
export function encodeBotToolsTag(payload: BotToolsWorkflow | BotToolsStep): string {
	return Buffer.from(JSON.stringify(payload)).toString('base64');
}
