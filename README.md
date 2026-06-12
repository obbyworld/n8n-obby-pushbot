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

Install it as a **custom extension** into `~/.n8n/custom`, the directory n8n
auto-scans for locally-developed nodes:

```bash
mkdir -p ~/.n8n/custom && cd ~/.n8n/custom
npm init -y                                      # first time only
npm install github:obbyworld/n8n-obby-pushbot
# then restart n8n
```

The package builds itself on install (via the `prepare` hook). After restarting
n8n and hard-refreshing the editor, the nodes appear in the **node panel** —
search **"Obby"** or "PushBot". They load into the palette, **not** Settings →
Community Nodes (that list only tracks packages installed through n8n's GUI).

> **Don't also install it into `~/.n8n/nodes`.** n8n loads it from there too (via
> that folder's `package.json`), so having it in both places makes every node
> appear twice. Pick one location — `~/.n8n/custom` is the clean choice for an
> unpublished node.

> Node version: n8n 2.15+ needs **Node ≥ 22.16**. If `node -v` shows older,
> select a newer one (e.g. `nvm use 22`) in the shell that launches n8n.

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
