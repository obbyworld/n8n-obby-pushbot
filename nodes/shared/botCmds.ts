/**
 * Build a bot-cmds command list from the Trigger node's "Slash Commands"
 * fixedCollection, ready to POST to /pushbot/v1/commands as { commands: [...] }.
 *
 * The plugin deals only in the raw JSON schema; the server base64-encodes the
 * +draft/bot-cmds tag for clients. Keep each command's compact JSON well under
 * the 4094-byte tag budget so the server need not chunk.
 */
import type { IDataObject } from 'n8n-workflow';
import { CommandContext, CommandOptionType } from './constants';
import type { CommandList, CommandOption, CommandRequires, CommandSchema } from './types';

/**
 * Translate the node's collected command rows into a CommandList.
 * @param raw The raw value of the node's "commands" fixedCollection, i.e. `{ command: [...] }`.
 */
export function buildCommandList(raw: IDataObject): CommandList {
	const rows = (raw?.command as IDataObject[] | undefined) ?? [];
	const commands: CommandSchema[] = [];

	for (const row of rows) {
		const name = String(row.name ?? '').trim();
		if (!name) continue;

		const contexts = ((row.contexts as CommandContext[] | undefined) ?? []).filter(Boolean);
		const cmd: CommandSchema = {
			name,
			description: String(row.description ?? ''),
			contexts: contexts.length ? contexts : [CommandContext.Public],
		};

		const optionRows = ((row.options as IDataObject | undefined)?.option as IDataObject[] | undefined) ?? [];
		const options: CommandOption[] = [];
		for (const o of optionRows) {
			const optName = String(o.name ?? '').trim();
			if (!optName) continue;
			const opt: CommandOption = {
				name: optName,
				type: (o.type as CommandOptionType) ?? CommandOptionType.String,
			};
			if (o.required === true) opt.required = true;
			const desc = String(o.description ?? '').trim();
			if (desc) opt.description = desc;
			const choices = String(o.choices ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean);
			if (choices.length) opt.choices = choices;
			options.push(opt);
		}
		if (options.length) cmd.options = options;

		const req = (row.requires as IDataObject | undefined) ?? {};
		const requires: CommandRequires = {};
		if (req.account === true) requires.account = true;
		if (req.tls === true) requires.tls = true;
		if (req['min-channel-rank']) {
			requires['min-channel-rank'] = req['min-channel-rank'] as CommandRequires['min-channel-rank'];
		}
		if (Object.keys(requires).length) cmd.requires = requires;

		commands.push(cmd);
	}

	return { commands };
}
