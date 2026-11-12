# Bifrost

[![ci](https://github.com/akanyane/bifrost/actions/workflows/ci.yml/badge.svg)](https://github.com/akanyane/bifrost/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Operate an Ubuntu server over SSH through **typed, scoped operations**, without opening a raw
shell and without ever giving an AI agent one. The same binary works as:

- a **CLI** for humans: `bifrost docker logs --container web --tail 50`
- a local **MCP server (stdio)** for agents: `bifrost mcp` (Claude Desktop, Cursor, Claude Code, …)

> **Status:** early (0.x). The API, config format and tool names may change between minor versions.

## Why

Giving an agent `ssh` (or a generic `run_command` tool) means one hallucination away from
`docker system prune -af` or `rm -rf`. Bifrost exposes a small set of intent-named operations
(`docker_logs`, `docker_restart`, `system_overview`, …) with strict schemas, and enforces the
real boundary **on the server**, so even a misbehaving client cannot do more than the allowlist permits.

## Security model

| Layer | Where | What it guarantees |
|---|---|---|
| `bifrost-gate` (forced command + sudo) | server | **The real boundary.** The Bifrost key can only run fixed verbs with validated arguments and a container allowlist. Holds even if someone uses the key outside Bifrost. |
| `bifrost` user not in the `docker` group | server | Docker is only reachable through the gate (docker group = root). |
| Pinned host key (`server.fingerprint`, or trusted at `bifrost connect`) | client | No MITM (`ssh2` does not verify host keys by default). |
| Per-surface policy (`maxRisk`) | client | MCP is `read` by default; tools above the limit are not even registered. |
| Zod schemas derived from the config | client | The agent only sees, and can only send, allowlisted containers and bounded numbers. |
| Token protocol | client | Shell is never sent: only `[A-Za-z0-9_.:-]` tokens. |
| Sanitization + `<untrusted_output>` fencing | client | ANSI and secrets stripped; server output marked as data, not instructions (prompt-injection mitigation). |
| Write rate limit, timeouts, byte cap, audit log | client | Contains looping agents; trail in `~/.local/state/bifrost/audit.jsonl`. |

## Getting started

Requires Node.js ≥ 22.18.

1. **Server:** follow [`remote/install.md`](remote/install.md).
2. **Connect** (IP, user and password, saved in a local SQLite store):
   ```bash
   bifrost connect --ip 203.0.113.10 --user bifrost        # prompts for the password without echo
   ```
   The first time, it shows the server's host key fingerprint and asks you to compare it with
   `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` run on the server (or pass `--fingerprint SHA256:...`).
   Then it checks the login and `bifrost-gate ping`.
   Alternatively, use key auth via `~/.config/bifrost/config.json` (see [`config.example.json`](config.example.json)).
3. **Containers / policy (optional):** a `config.json` with only `containers`, `policy` and `limits` is still
   read; the active connection supplies `server` and `auth`.
4. **Check:** `bifrost doctor`

### Saved connections

| Command | What it does |
|---|---|
| `bifrost connect --ip <host> --user <user> [--password <pw>] [--port 22] [--fingerprint SHA256:...] [--name default]` | Verify, test and save a server; it becomes the active one. Reconnecting to the same host reuses the trusted fingerprint (a changed key is refused). |
| `bifrost connections` | List saved connections (`*` = active). Passwords are never printed. |
| `bifrost use <name>` | Switch the active connection. |
| `bifrost disconnect [--name default]` | Delete a connection and its password. |

The store lives at `~/.local/share/bifrost/bifrost.db` (override with `BIFROST_DB`), mode `0600`.
**The password is stored in plain text** there: anything that can read your files, including an AI agent with
a terminal, can read it. Avoid `--password` on the command line (shell history, `ps`); omit it to be prompted.
With password login, the server must force the gate for that user via `ForceCommand`
(see [`remote/install.md`](remote/install.md#password-login)), otherwise the password is a full shell.

```bash
git clone https://github.com/akanyane/bifrost.git && cd bifrost
npm install && npm run build

node dist/bifrost.js doctor
node dist/bifrost.js system overview
node dist/bifrost.js docker ps
node dist/bifrost.js docker logs --container web --tail 50 --since-minutes 30
node dist/bifrost.js docker restart --container web   # write: allowed on the CLI, blocked on MCP by default
node dist/bifrost.js --json docker ps                 # machine-readable output
```

### Configuration

| Key | Default | Description |
|---|---|---|
| `server.host` / `port` / `username` | – / `22` / `bifrost` | SSH target. |
| `server.fingerprint` | required | Host key fingerprint, `SHA256:...` (from `ssh-keygen -lf` on the server). |
| `server.hostKeyAlgorithm` | `ssh-ed25519` | Pinned host key algorithm, so the fingerprint always refers to the same key. |
| `auth` | `{ "method": "agent" }` | `agent` (uses `SSH_AUTH_SOCK`) or `{ "method": "key", "privateKeyPath", "passphraseEnv" }`. Password auth only comes from `bifrost connect`, never from this file. |
| `containers` | `[]` | Allowlist. Must match `/etc/bifrost/containers` on the server. |
| `policy.cli.maxRisk` | `write` | Highest risk (`read` < `write` < `destructive`) allowed from the CLI. |
| `policy.mcp.maxRisk` | `read` | Highest risk allowed for agents. |
| `policy.mcp.writesPerWindow` / `windowSeconds` | `5` / `600` | Rate limit for agent write operations. |
| `limits.timeoutMs` / `maxOutputBytes` / `maxChannels` | `15000` / `65536` / `4` | Per-command timeout, output cap, concurrent SSH channels. |

When a connection is active (`bifrost connect`), it overrides `server` and `auth`. The config path can be overridden with `--config <path>` or `BIFROST_CONFIG`. Log level via `BIFROST_LOG` (`debug`, `info`, `warn`, `error`, `silent`).

## Using it as an MCP server

Claude Desktop (`claude_desktop_config.json`) / Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "bifrost": {
      "command": "node",
      "args": ["/absolute/path/to/bifrost/dist/bifrost.js", "mcp"],
      "env": { "SSH_AUTH_SOCK": "/path/to/your/ssh-agent.sock" }
    }
  }
}
```

GUI apps usually do not inherit `SSH_AUTH_SOCK` from your shell: pass it explicitly (or use
`auth.method: "key"` with `passphraseEnv`). To inspect the server interactively: `npm run inspect`.

Tools exposed with the default policy:

| Tool | Risk | Description |
|---|---|---|
| `system_overview` | read | Hostname, uptime, load, memory, disk, running containers. |
| `docker_list_containers` | read | All containers with name, image, state, status and whether they are allowlisted. |
| `docker_logs` | read | Last N lines (≤ 500) of an allowlisted container, optionally within the last N minutes. |
| `docker_restart` | write | Hidden from agents unless `policy.mcp.maxRisk` is `write`. |

## Development

```bash
npm run dev -- docker ps     # runs the TypeScript directly (Node ≥ 22.18 type stripping)
npm test                     # node:test, includes the real gate script against a fake docker and injection payloads
npm run typecheck
npm run build                # tsup -> dist/bifrost.js
```

Layout:

```
src/
  bin/bifrost.ts            single entry point
  core/                     ssh (persistent session, host key, bounded runner), config, policy, gate, sanitize, audit, logger
  operations/               defineOperation + registry (single source of truth) + execute (policy → validation → rate limit → run → audit)
  adapters/cli/             Commander commands generated from the registry
  adapters/mcp/             MCP tools generated from the registry
remote/                     bifrost-gate.sh + server setup guide
test/
```

Code rules: no TypeScript syntax that emits JS (`enum`, `namespace`, parameter properties;
enforced by `erasableSyntaxOnly`), and nothing outside `adapters/cli` writes to stdout (a test enforces it).

### Adding an operation

1. Add the verb to `remote/bifrost-gate.sh` (validate every argument, `exec` with an argv array, never `eval`) plus a case in `test/gate.test.ts`.
2. Create `src/operations/<group>/<op>.ts` with `defineOperation` (explicit verb in the name, an honest `risk`, a description that states its limits).
3. Register it in `src/operations/registry.ts`. The CLI command and the MCP tool appear automatically.

### Releases

Releases are automated with [release-please](https://github.com/googleapis/release-please).
Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `feat!:` for breaking changes, …).
On every push to `main` a Release PR is opened or updated; merging it bumps the version
(`package.json` and `src/version.ts`), updates `CHANGELOG.md`, and publishes a GitHub release.

## License

[MIT](LICENSE)
