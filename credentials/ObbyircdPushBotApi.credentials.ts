import type {
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * obbyircd PushBot — the single credential every node reads from.
 *
 * Carries only the durable, operator-entered fields. The per-bot secrets
 * minted by `pushbot.register` (bot_id, token, webhook_secret) are written
 * to workflow static data at registration time, NOT here, because n8n nodes
 * cannot write the credential store at runtime. The "Manual override"
 * section exists only for advanced/cross-workflow use where you already
 * hold a token and want every node to use it directly.
 */
export class ObbyircdPushBotApi implements ICredentialType {
	name = 'obbyircdPushBotApi';

	displayName = 'obbyircd PushBot API';

	documentationUrl = 'https://github.com/obbyworld/n8n-obby-pushbot#readme';

	properties: INodeProperties[] = [
		{
			displayName: 'Server Hostname',
			name: 'host',
			type: 'string',
			default: '',
			placeholder: 'obby.t3ks.com',
			required: true,
			description: 'The obbyircd host. The RPC/TLS listener is reached at this host.',
		},
		{
			displayName: 'Server Port',
			name: 'port',
			type: 'number',
			default: 8600,
			required: true,
			description: 'Port carrying options { rpc; tls; }. RPC listeners auto-force TLS, so https/wss is always used.',
		},
		{
			displayName: 'RPC Username',
			name: 'rpcUser',
			type: 'string',
			default: '',
			required: true,
			description: 'rpc-user with rpc-class full (read-only does NOT grant pushbot.*). Used for register/lifecycle only.',
		},
		{
			displayName: 'RPC Password',
			name: 'rpcPassword',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
		},
		{
			displayName: 'Bot Nick',
			name: 'botNick',
			type: 'string',
			default: '',
			placeholder: 'weather',
			required: true,
			description: 'The IRC nick this bot will own. One credential = one bot.',
		},
		{
			displayName: 'Registration Secret',
			name: 'registrationSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Optional. Only needed for the REST self-registration path (pushbot::registration-secret). Leave blank to use JSON-RPC registration.',
		},
		{
			displayName: 'Allow Unauthorized Certificates',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: false,
			description: 'Whether to accept a TLS certificate that does not validate (e.g. a localhost listener whose cert is issued for the public hostname).',
		},
		{
			displayName: 'Manual Secret Override',
			name: 'manualOverride',
			type: 'fixedCollection',
			placeholder: 'Add Override',
			default: {},
			description: 'Advanced. Provide a pre-existing token to bypass auto-registration / static-data storage (e.g. driving one bot from several workflows).',
			options: [
				{
					name: 'values',
					displayName: 'Values',
					values: [
						{
							displayName: 'Bot ID',
							name: 'botId',
							type: 'string',
							default: '',
						},
						{
							displayName: 'Bot Token',
							name: 'token',
							type: 'string',
							typeOptions: { password: true },
							default: '',
						},
						{
							displayName: 'Webhook Secret',
							name: 'webhookSecret',
							type: 'string',
							typeOptions: { password: true },
							default: '',
						},
					],
				},
			],
		},
	];
}
