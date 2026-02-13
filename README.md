# xcode-copilot-server [![npm version](https://img.shields.io/npm/v/xcode-copilot-server)](https://www.npmjs.com/package/xcode-copilot-server)

A proxy API server that lets you use GitHub Copilot in Xcode, either as a custom model provider (OpenAI mode) or as the backend for Claude Agent (Anthropic mode).

## Why

Xcode 26 added support for third-party LLM providers, but it only supports ChatGPT and Claude out of the box. If you have a GitHub Copilot subscription, there's no built-in way to use it.

This server bridges the gap by wrapping the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) and exposing it as an API that Xcode can talk to. It supports two modes:

- **OpenAI mode** (default): This exposes an OpenAI-compatible API so Xcode can use Copilot as a custom model provider. Xcode handles tool execution directly.
- **Anthropic mode**: This exposes an Anthropic-compatible API so Xcode can use Copilot as the proxy for Claude Agent. A built-in tool bridge intercepts tool calls from the Copilot session and routes them back to Xcode for execution.

Both modes connect to Xcode's built-in MCP tools (via `xcrun mcpbridge`), giving Copilot access to your project's build logs, indexes and other context. This requires Xcode 26.3 or later.

## Installation

You need [Node.js](https://nodejs.org) 25.6.0 or later and a GitHub Copilot subscription. Before starting the server, authenticate using one of the following methods (the Copilot CLI is bundled with the SDK, so you only need one of these for initial sign-in):

- [Install the Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/install-copilot-cli) and run `copilot login`
- [Install the GitHub CLI](https://cli.github.com/) and run `gh auth login`
- Set a `GITHUB_TOKEN` environment variable with a valid fine-grained Copilot access token

Then install the server via:

```bash
npm install -g xcode-copilot-server
```

Or run it without installing globally:

```bash
npx xcode-copilot-server
```

## Usage

```bash
xcode-copilot-server [options]

Options:
  -p, --port <number>      Port to listen on (default: 8080)
  --proxy <provider>       API format: openai, anthropic (default: openai)
  -l, --log-level <level>  Log verbosity (default: info)
  -c, --config <path>      Path to config file
  --cwd <path>             Working directory for Copilot sessions
  --auto-patch             Auto-patch settings.json on start, restore on exit
  -v, --version            Output the version number
  -h, --help               Show help

Commands:
  patch-settings           Patch Claude Agent's settings.json and exit (Anthropic mode)
  restore-settings         Restore Claude Agent's settings.json from backup and exit
```

The `--proxy` flag determines which API the server exposes:

| Mode      | Flag                       | Routes                                                |
|-----------|----------------------------|-------------------------------------------------------|
| OpenAI    | `--proxy openai` (default) | `GET /v1/models`, `POST /v1/chat/completions`         |
| Anthropic | `--proxy anthropic`        | `POST /v1/messages`, `POST /v1/messages/count_tokens` |

## Xcode integration

### OpenAI mode (custom model provider)

1. Start the server: `xcode-copilot-server`
2. Open Xcode and go to Settings > Intelligence > Add a provider
3. Select "Locally hosted" and set the port to 8080 (or the port that you've chosen)
4. Give it a description e.g. "Copilot"
5. Save

To enable tool calling, select the provider and enable "Allow tools" under "Advanced". To connect Xcode's MCP tools (Xcode 26.3+), enable "Xcode Tools" under "Model Context Protocol".

### Anthropic mode (Claude Agent)

1. Open Xcode and go to Settings > Intelligence > Anthropic > Claude Agent
2. Enable Claude Agent and sign in with an API key (the key can be any random text, since the calls are proxied through the server)
3. Start the server with `--auto-patch` to automatically configure `settings.json`:

   ```bash
   xcode-copilot-server --proxy anthropic --auto-patch
   ```

   This creates (or updates) `settings.json` at `~/Library/Developer/Xcode/CodingAssistant/ClaudeAgentConfig/` to point to the server, and restores the original file when the server shuts down. If `settings.json` already exists, a backup is saved as `settings.json.backup` and restored on exit.

   Alternatively, you can manage `settings.json` yourself. Create it manually at the path above:

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
   xcode-copilot-server --proxy anthropic
   ```

   You can also use the `patch-settings` and `restore-settings` subcommands to patch or restore `settings.json` without starting the server:

   ```bash
   xcode-copilot-server patch-settings --port 8080
   xcode-copilot-server restore-settings
   ```

The tool bridge is enabled by default in Anthropic mode (`toolBridge: true` in the config). It intercepts tool calls from the Copilot session and forwards them to Xcode, so Claude Agent can read files, search code, and make edits through the IDE.

### Agent skills

The underlying Copilot CLI session can access and invoke [Agent skills](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-coding-agent-with-agent-skills), which are folders of instructions, scripts, and resources that improve Copilot's performance on specialised tasks. Skills stored in your repository (`.github/skills/` or `.claude/skills/`) and personal skills in your home directory (`~/.copilot/skills/` or `~/.claude/skills/`) are automatically available.

## Configuration

The server reads its configuration from a `config.json5` file. By default, it uses the bundled one, but you can point to your own with `--config`:

```bash
xcode-copilot-server --config ./my-config.json5
```

The config file uses [JSON5](https://json5.org/) format, which supports comments and trailing commas. The `--proxy` flag determines which provider section (`openai` or `anthropic`) is used at runtime:

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

  anthropic: {
    // Intercepts tool calls and forwards them to Xcode so Claude Agent
    // can drive tool execution through the IDE.
    toolBridge: true,

    // No MCP servers needed, as Claude Agent handles tools natively.
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

## Security

This server acts as a local proxy between Xcode and GitHub Copilot. It's designed to run on your machine and isn't intended to be exposed to the internet or shared networks. So, here's what you should know:

- The server binds to `127.0.0.1`, so it's only reachable from your machine. Incoming requests are checked for expected user-agent headers (`Xcode/` in OpenAI mode, `claude-cli/` in Anthropic mode), which means casual or accidental connections from other tools will be rejected. This isn't a strong security boundary since user-agent headers can be trivially spoofed, but it helps ensure only the expected client is talking to the server.

- The bundled config sets `autoApprovePermissions` to `["read", "mcp"]`, which lets the Copilot session read files and call MCP tools without prompting. Writes, shell commands, and URL fetches are denied by default. You can set it to `true` to approve everything, `false` to deny everything, or pick specific kinds from `"read"`, `"write"`, `"shell"`, `"mcp"`, and `"url"`.

- MCP servers defined in the config are spawned as child processes. The bundled config uses `xcrun mcpbridge`, which is an Apple-signed binary. If you add your own MCP servers, make sure you trust the commands you're configuring.

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
