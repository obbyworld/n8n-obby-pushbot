# n8n-nodes-obby-pushbot

An [n8n](https://n8n.io) community node that turns n8n into a no-code bot
workshop for the **[obbyircd](https://github.com/obbyworld) PushBot** transport.
Give it a server, a couple of credentials and a bot nick — it registers the
bot, mints and persists the token + webhook secret, verifies every inbound
signature, publishes your slash-command schema, and routes events onto the
canvas. You build the bot's behaviour by wiring nodes, not by writing code.

> Status: **early / pre-release (`0.1.x`).** The registration, signature, and
> event-routing spine is implemented and type-checked; it has not yet been
> validated against a live server end-to-end. Expect rough edges.

## Nodes

| Node | What it does |
|---|---|
| **PushBot Event** (trigger) | On activation, registers the bot (`transport: webhook`) pointed at this node's webhook URL, stashes its token + secret in workflow static data, and publishes the slash commands you define. On each delivery it verifies `X-PushBot-Signature` and routes the event to a named output (Command Invoke · Message · Channel Join/Part/Kick · Workflow Action · Lifecycle). |
| **PushBot Respond / Send / Manage** (action) | Every outbound verb: reply to / defer / error a slash command; stream `+draft/bot-tools` workflow progress; send channel messages & DMs; react / redact; join / part; and admin lifecycle (approve / suspend / unsuspend / delete / list / get) over JSON-RPC. |

Both read everything they need from one credential — you never touch a
`bot_id`, Bearer token, HMAC, or base64 tag by hand.

## Install

### From GitHub (works today — no npm publish needed)

On a self-hosted n8n, install into the directory n8n scans for community nodes
(`~/.n8n/nodes` by default; set `N8N_USER_FOLDER` if yours differs):

```bash
cd ~/.n8n/nodes        # create it (and `npm init -y`) if it doesn't exist
npm install github:obbyworld/n8n-obby-pushbot
```

The package builds itself on install (via the `prepare` hook). Restart n8n and
the two nodes appear under **PushBot**.

### From npm (once published)

Settings → **Community Nodes** → **Install** → `n8n-nodes-obby-pushbot`.

## Quick start

1. **Create the credential** *obbyircd PushBot API*: server host + port (the
   `options { rpc; tls; }` listener, usually `8600`), the `rpc-user` /
   `rpc-password` (the rpc-class must be `full`), and your bot nick. Tick
   *Allow Unauthorized Certificates* if your listener's cert is for a different
   hostname (common on localhost).
2. **Drop a *PushBot Event* node**, pick the credential, and define a slash
   command (e.g. `weather` with a `city` option). Activate the workflow — the
   bot registers itself.
3. **Wire the *Command Invoke* output** to a *PushBot Respond* node set to
   **Interaction → Respond**, with the interaction id left as
   `{{ $json.id }}`. Fast replies (under ~3s) just answer; for slow work, add
   a **Defer** or a **Workflow → Start** first.

## Server prerequisites

- The `pushbot` module loaded, with `pushbot::mode` set to `approval` or `open`
  (under `admin` the plugin can't self-register).
- An `rpc-user { ... rpc-class full; }` block (read-only does **not** grant
  `pushbot.*`).
- A TLS RPC listener (`options { rpc; tls; }`) — RPC auto-forces TLS.

If `mode` is `approval`, the bot registers `pending`; an operator runs
`/PUSHBOT APPROVE <nick>` before events flow.

## Development

```bash
npm install      # also builds via the prepare hook
npm run build    # tsc + copy icons
npm run lint
```

Source layout: `credentials/` (the one credential), `nodes/PushBotTrigger` and
`nodes/PushBotAction` (the two nodes), `nodes/shared` (all protocol plumbing —
transport, signature, static-data store, bot-cmds / bot-tools builders).

## License

[MIT](./LICENSE)
