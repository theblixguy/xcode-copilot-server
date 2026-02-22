# xcode-copilot-server [![npm version](https://img.shields.io/npm/v/xcode-copilot-server)](https://www.npmjs.com/package/xcode-copilot-server)

A proxy API server that lets you use GitHub Copilot in Xcode, either as a custom model provider or as the backend for Claude Agent and Codex Agent.

![Screenshot](assets/screenshot.png)

## Why

Xcode 26 added support for third-party LLM providers, but it only supports ChatGPT and Claude out of the box. If you have a GitHub Copilot subscription, there's no built-in way to use it.

This server bridges the gap by wrapping the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) and exposing it as an API that Xcode can talk to. It supports three providers:

- **OpenAI** (default): Exposes an OpenAI-compatible completions API so Xcode can use Copilot as a custom model provider. Xcode handles tool execution directly.
- **Claude**: Exposes an Anthropic-compatible API so Xcode can use Copilot as the backend for Claude Agent. A built-in tool bridge intercepts tool calls and routes them back to Xcode for execution.
- **Codex**: Exposes an OpenAI Responses-compatible API so Xcode can use Copilot as the backend for Codex Agent. Same tool bridge as Claude.

In OpenAI mode, the server also connects to Xcode's built-in MCP tools (via `xcrun mcpbridge`), giving Copilot access to your project's build logs, indexes and other context. This requires Xcode 26.3 or later. Claude and Codex handle MCP internally through their own agents.

## Quick start

You need [Node.js](https://nodejs.org) 25.6.0 or later and a GitHub Copilot subscription.

**1. Authenticate** with one of these (you only need one):

```bash
copilot login # Copilot CLI
gh auth login # GitHub CLI
```

Or set a `GITHUB_TOKEN` environment variable with a valid fine-grained Copilot access token.

**2. Install:**

```bash
npm install -g xcode-copilot-server
```

**3. Pick your provider and start the server:**

<details>
<summary>OpenAI (custom model provider)</summary>

1. In Xcode, go to Settings > Intelligence > Add a provider
2. Select "Locally hosted" and set the port to 8080 (or whatever port you chose)
3. Give it a description e.g. "Copilot" and save
4. Start the server:

   ```bash
   xcode-copilot-server
   ```

To enable tool calling, select the provider and enable "Allow tools" under "Advanced". To connect Xcode's MCP tools (Xcode 26.3+), enable "Xcode Tools" under "Model Context Protocol".

</details>

<details>
<summary>Claude (Claude Agent)</summary>

1. In Xcode, go to Settings > Intelligence > Anthropic > Claude Agent
2. Enable Claude Agent and sign in with an API key (the key can be any random text, since calls are proxied through the server)
3. Start the server:

   ```bash
   xcode-copilot-server --proxy claude --auto-patch
   ```

The `--auto-patch` flag creates (or updates) `settings.json` at `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/` to point to the server, and restores the original file when the server shuts down.

The tool bridge is enabled by default (`toolBridge: true` in the config). It intercepts tool calls from the Copilot session and forwards them to Xcode, so Claude Agent can read files, search code, and make edits through the IDE.

<details>
<summary>Manual setup (without --auto-patch)</summary>

Create `settings.json` at `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_AUTH_TOKEN": "12345"
  }
}
```

Set the port to match your `--port` flag (default 8080). The auth token can be any non-empty string. Then start the server without `--auto-patch`:

```bash
xcode-copilot-server --proxy claude
```

You can also use the `patch-settings` and `restore-settings` subcommands to patch or restore settings without starting the server:

```bash
xcode-copilot-server patch-settings --proxy claude --port 8080
xcode-copilot-server restore-settings --proxy claude
```

</details>

</details>

<details>
<summary>Codex (Codex Agent)</summary>

1. In Xcode, go to Settings > Intelligence > OpenAI > Codex Agent
2. Enable Codex Agent and sign in with an API key (the key can be any random text, since calls are proxied through the server)
3. Start the server:

   ```bash
   xcode-copilot-server --proxy codex --auto-patch
   ```

The `--auto-patch` flag sets `OPENAI_BASE_URL` and `OPENAI_API_KEY` via `launchctl setenv` so Xcode (and any Codex process it spawns) can reach the server. The original values are backed up and restored when the server shuts down.

You might need to restart Xcode so it picks up the new environment variables.

The tool bridge works the same way as Claude, intercepting tool calls and routing them back to Xcode for execution.

<details>
<summary>Manual setup (without --auto-patch)</summary>

Set the environment variables yourself via `launchctl`:

```bash
launchctl setenv OPENAI_BASE_URL http://localhost:8080/v1
launchctl setenv OPENAI_API_KEY 12345
```

Set the port to match your `--port` flag (default 8080). The API key can be any non-empty string. Then start the server without `--auto-patch`:

```bash
xcode-copilot-server --proxy codex
```

To restore the original values when you're done:

```bash
launchctl unsetenv OPENAI_BASE_URL
launchctl unsetenv OPENAI_API_KEY
```

You can also use the `patch-settings` and `restore-settings` subcommands to do this without starting the server:

```bash
xcode-copilot-server patch-settings --proxy codex --port 8080
xcode-copilot-server restore-settings --proxy codex
```

</details>

</details>

> [!TIP]
> If you want to run the server in the background with automatic start/stop, see [Launchd agent](#launchd-agent) below.

## Agent skills

[Agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) are an open standard for extending AI coding agents with specialised instructions and resources. All three providers support them through the underlying Copilot SDK session, and each agent also has its own skill paths:

| Agent   | Project skills                             | Personal skills        |
|---------|--------------------------------------------|------------------------|
| Copilot | `.github/skills/`, `.claude/skills/`       | `~/.copilot/skills/`   |
| Claude  | `.claude/skills/`                          | `~/.claude/skills/`    |
| Codex   | `.codex/skills/`                           | `~/.codex/skills/`     |

## Launchd agent

Instead of starting the server manually every time, you can install it as a launchd agent. This uses macOS socket activation, so the server starts automatically when something connects to the port (e.g. when Xcode sends its first request) and you don't need to keep a terminal open.

### Installing

```bash
xcode-copilot-server install-agent --proxy claude --auto-patch
```

This writes a plist to `~/Library/LaunchAgents/` and loads it with `launchctl`. The agent is set up with socket activation on the specified port, so launchd owns the socket and starts the server on demand. If `--auto-patch` is passed, settings are patched at install time.

The `install-agent` subcommand accepts the same options as the main command (`--port`, `--proxy`, `--log-level`, `--config`, `--cwd`, `--auto-patch`), plus `--idle-timeout` which defaults to 60 minutes for the agent. After 60 minutes with no requests, the server shuts itself down. The next incoming connection will start it again automatically.

Server logs go to `~/Library/Logs/xcode-copilot-server.out.log` and `~/Library/Logs/xcode-copilot-server.err.log`.

### Uninstalling

```bash
xcode-copilot-server uninstall-agent
```

This unloads the agent, deletes the plist, and restores any patched settings if the agent was installed with `--auto-patch`.

### How it works

Launchd creates a socket on the configured port and waits. When a connection comes in (e.g. Xcode sends a request), launchd starts the server process and hands over the socket. The server handles requests as normal.

If the server crashes, launchd doesn't restart it immediately, but the next incoming connection will start a fresh process. If `--idle-timeout` is set (defaults to 60 minutes for the agent), the server exits after that many minutes of inactivity, and launchd will start it again on the next connection.

To check if the agent is loaded:

```bash
launchctl list | grep xcode-copilot-server
```

## Configuration

The server reads its configuration from a `config.json5` file. By default, it uses the bundled one, but you can point to your own with `--config`:

```bash
xcode-copilot-server --config ./my-config.json5
```

The config file uses [JSON5](https://json5.org/) format, which supports comments and trailing commas. The `--proxy` flag determines which provider section (`openai`, `claude`, or `codex`) is used at runtime:

```json5
{
  openai: {
    // No tool bridge needed, as Xcode drives tool execution directly.
    toolBridge: false,

    mcpServers: {
      // Proxies Apple's xcrun mcpbridge (Xcode 26.3+).
      xcode: {
        type: "local",
        command: "node",
        args: ["./scripts/mcpbridge-proxy.mjs"],
        allowedTools: ["*"],
      },
    },
  },

  claude: {
    // Intercepts tool calls and forwards them to Xcode so Claude Agent
    // drives tool execution through the IDE instead of the Copilot CLI.
    toolBridge: true,

    // No MCP servers needed, as Claude Agent handles tools natively.
    mcpServers: {},
  },

  codex: {
    // Same as Claude: intercepts tool calls and forwards them to Xcode
    // so Codex drives tool execution through the IDE.
    toolBridge: true,

    mcpServers: {},
  },

  // Built-in CLI tools allowlist.
  // ["*"] to allow all, [] to deny all, or a list of specific tool names.
  //
  // Empty by default so Xcode can handle all operations (search, read, edit)
  // through its UI. Enabling CLI tools lets the Copilot session perform
  // those operations directly, bypassing Xcode.
  allowedCliTools: [],

  // Maximum request body size in MiB.
  bodyLimitMiB: 10,

  // Filename patterns to filter out from search results in the prompt.
  //
  // Xcode can include full file contents for every search match, so add patterns
  // here to strip files that bloat the prompt (e.g. ["mock", "generated"]).
  excludedFilePatterns: [],

  // Reasoning effort for models that support it: "low", "medium", "high", "xhigh"
  reasoningEffort: "xhigh",

  // Auto-approve permission requests.
  // true to approve all, false to deny all,
  // or an array of kinds: "read", "write", "shell", "mcp", "url"
  autoApprovePermissions: ["read", "mcp"],
}
```

## CLI reference

```text
xcode-copilot-server [options]

Options:
  -p, --port <number>            Port to listen on (default: 8080)
  --proxy <provider>             API format: openai, claude, codex (default: openai)
  -l, --log-level <level>        Log verbosity (default: info)
  -c, --config <path>            Path to config file
  --cwd <path>                   Working directory for Copilot sessions
  --auto-patch                   Auto-patch settings on start, restore on exit
  --idle-timeout <minutes>       Shut down after N minutes of inactivity (default: 0, disabled)
  -v, --version                  Output the version number
  -h, --help                     Show help

Commands:
  patch-settings                 Patch provider settings and exit (--proxy claude or codex)
  restore-settings               Restore provider settings from backup and exit
  install-agent                  Install a launchd agent with socket activation
  uninstall-agent                Uninstall the launchd agent and restore settings
```

The `--proxy` flag determines which API the server exposes:

| Provider | Flag                       | Routes                                                |
|----------|----------------------------|-------------------------------------------------------|
| OpenAI   | `--proxy openai` (default) | `GET /v1/models`, `POST /v1/chat/completions`         |
| Claude   | `--proxy claude`           | `POST /v1/messages`, `POST /v1/messages/count_tokens` |
| Codex    | `--proxy codex`            | `POST /v1/responses`                                  |

## Security

This server acts as a local proxy between Xcode and GitHub Copilot. It's designed to run on your machine and isn't intended to be exposed to the internet or shared networks. So, here's what you should know:

- The server binds to `127.0.0.1`, so it's only reachable from your machine. Incoming requests are checked for expected user-agent headers (`Xcode/` for OpenAI and Codex, `claude-cli/` for Claude), which means casual or accidental connections from other tools will be rejected. This isn't a strong security boundary since user-agent headers can be trivially spoofed, but it helps ensure only the expected client is talking to the server.

- The bundled config sets `autoApprovePermissions` to `["read", "mcp"]`, which lets the Copilot session read files and call MCP tools without prompting. Writes, shell commands, and URL fetches are denied by default. You can set it to `true` to approve everything, `false` to deny everything, or pick specific kinds from `"read"`, `"write"`, `"shell"`, `"mcp"`, and `"url"`.

- MCP servers defined in the config are spawned as child processes. The bundled config uses `xcrun mcpbridge`, which is an Apple-signed binary. If you add your own MCP servers, make sure you trust the commands you're configuring.

- When you use `install-agent`, the generated plist file includes your `PATH` in cleartext so the agent can find Node.js. The file is written to `~/Library/LaunchAgents/` which is only readable by your user account by default.

> [!NOTE]
> If you authenticated with a `GITHUB_TOKEN` environment variable, that token is also embedded in the plist. If you'd rather not have a token in the plist, use `gh auth login` or `copilot login` instead.

## License

MIT License

Copyright (c) 2026 Suyash Srijan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
