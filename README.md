# xcode-copilot-server [![npm version](https://img.shields.io/npm/v/xcode-copilot-server)](https://www.npmjs.com/package/xcode-copilot-server)

An OpenAI-compatible proxy API server that lets you use GitHub Copilot in Xcode.

## Why

Xcode 26 added support for third-party LLM providers, but it only supports ChatGPT and Claude out of the box. If you have a GitHub Copilot subscription and want to use it in Xcode, that's not possible as there's no built-in option for it.

However, Xcode does let you add a custom model provider, as long as it exposes an OpenAI-compatible API. GitHub Copilot doesn't do that, but this server helps bridges the gap by wrapping the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) and exposing it as an OpenAI-compatible API that Xcode can talk to.

It also connects to Xcode's built-in MCP tools (via `xcrun mcpbridge`), giving Copilot access to your project's build logs, indexes and other context that Xcode provides. This requires Xcode 26.3 or later.

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
  --port <number>      Port to listen on (default: 8080)
  --log-level <level>  Log verbosity: none, error, warning, info, debug, all (default: info)
  --config <path>      Path to config file (default: bundled config.json5)
  --cwd <path>         Working directory for Copilot sessions (default: process cwd)
  --help               Show help
```

The server listens on `http://localhost:8080` by default and exposes two routes:

- `GET /v1/models` — lists available models from your Copilot subscription
- `POST /v1/chat/completions` — handles chat completion requests (streaming)

## Xcode integration

1. Start the server: `xcode-copilot-server`
2. Open Xcode and go to Settings > Intelligence > Add a provider
3. Select "Locally hosted" and set the port to 8080 (or the port that you've chosen)
4. Give it a description e.g. "Copilot"
5. Save

That's it!

### Tool calling

There's an additional step if you want to use tool calling:

1. Open Xcode and go to Settings > Intelligence
2. Select the provider (e.g. "Copilot" from above)
3. Enable "Allow tools" under "Advanced"

### MCP

There's an additional step if you want to use Xcode MCP server (requires Xcode 26.3+):

1. Open Xcode and go to Settings > Intelligence
2. Enable "Xcode Tools" under "Model Context Protocol"

### Agent skills

The underlying Copilot CLI session can access and invoke [Agent skills](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-coding-agent-with-agent-skills), which are folders of instructions, scripts, and resources that improve Copilot's performance on specialised tasks. Skills which are stored in your repository (`.github/skills/` or `.claude/skills/`) and personal skills in your home directory (`~/.copilot/skills/` or `~/.claude/skills/`) are automatically available.

## Configuration

The server reads its configuration from a `config.json5` file. By default, it uses the bundled one, but you can point to your own with `--config`:

```bash
xcode-copilot-server --config ./my-config.json5
```

The config file uses [JSON5](https://json5.org/) format, which supports comments and trailing commas:

```json5
{
  // MCP servers to register with the Copilot session.
  // The bundled config includes Xcode's mcpbridge by default.
  mcpServers: {
    xcode: {
      type: "local",
      command: "node",
      args: ["./scripts/mcpbridge-proxy.mjs"],
      allowedTools: ["*"],
    },
  },

  // Built-in CLI tools allowlist.
  // ["*"] to allow all, [] to deny all, or a list of specific tool names.
  //
  // Empty by default so Xcode can handle all operations (search, read, edit)
  // through its UI. Enabling CLI tools lets the Copilot session perform
  // those operations directly, bypassing Xcode.
  allowedCliTools: [],

  // Maximum request body size in MiB.
  bodyLimitMiB: 4,

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

- The server binds to `127.0.0.1`, so it's only reachable from your machine, not from your local network or the internet. Incoming requests are checked for Xcode's user-agent, which means casual or accidental connections from other tools will be rejected. This isn't a strong security boundary since user-agent headers can be trivially spoofed, but it helps ensure only Xcode is talking to the server.

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
