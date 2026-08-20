# OnlyCLI

[![npm](https://img.shields.io/npm/v/onlycli?color=cb3837&label=npm)](https://www.npmjs.com/package/onlycli)
[![GitHub](https://img.shields.io/badge/GitHub-only--cli-181717?logo=github)](https://github.com/OnlyGhostTR/only-cli)
[![license](https://img.shields.io/npm/l/onlycli)](https://github.com/OnlyGhostTR/only-cli/blob/master/README.md)

BYOK (Bring Your Own Key) AI agent for your terminal. You supply the API key, requests go
straight to the provider — no proxy, no token markup. Beyond editing files, OnlyCLI can
drive game engines over MCP: Roblox Studio and Godot 4 are live.

```bash
npm install -g onlycli
onlycli auth add --provider anthropic
onlycli
```

Requires Node.js 18.17+.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [CLI commands](#cli-commands)
- [Slash commands](#slash-commands)
- [Saved preferences](#saved-preferences)
- [Approval and `/auto`](#approval-and-auto)
- [Providers](#providers)
- [Game engines over MCP](#game-engines-over-mcp)
- [Web access](#web-access)
- [Where keys are stored](#where-keys-are-stored)
- [Security behavior](#security-behavior)
- [Development](#development)

## Install

```bash
npm install -g onlycli
onlycli --version
```

From source:

```bash
npm install
npm run build
npm link          # makes `onlycli` available everywhere
```

`npm link` points at `dist/`, so re-run `npm run build` after changes. Remove it with
`npm unlink -g onlycli`. If the command is not found, restart the terminal — PATH changes
do not apply to already-open sessions.

### If `onlycli` is not found after a global install

`npm install -g` writes the command into npm's own global bin directory but does not put
that directory on your PATH. When it is missing, the install still reports success and the
shell then says `command not found: onlycli` — the package is fine, only the lookup path
is. (`pnpm add -g` does not hit this, because `pnpm setup` writes its bin directory into
your shell profile.)

The installer detects this and prints the exact directory plus the line to add. To have it
written for you:

```bash
ONLYCLI_FIX_PATH=1 npm install -g onlycli
```

That appends a PATH line to `~/.zshrc`, `~/.bashrc` (`~/.bash_profile` on macOS), or
`~/.config/fish/config.fish`, depending on `$SHELL`. Open a new terminal afterwards. To
check the directory yourself:

```bash
npm prefix -g      # the command lives in <prefix>/bin, or <prefix> on Windows
```

Set `ONLYCLI_SKIP_POSTINSTALL=1` to skip the check entirely.

During development, skip the build with `npm run dev` (chat) or
`npm run dev -- agent "..."`.

## Quick start

```bash
# 1. Store a key (entered as hidden input)
onlycli auth add --provider anthropic

# 2. Interactive chat
onlycli

# 3. Or a one-off request
onlycli agent "find the off-by-one error in this function" -f src/utils.ts
```

## CLI commands

| Command | Description |
| --- | --- |
| `onlycli` / `onlycli chat` | Interactive chat. Default command. |
| `onlycli agent "<prompt>"` | Single request, then exit. |
| `onlycli auth add\|list\|remove\|default` | Manage provider API keys. |
| `onlycli auth endpoint` | Set or show the OpenAI-compatible endpoint. |
| `onlycli auth search add\|list\|remove` | Manage optional web-search keys. |
| `onlycli status` | Show membership state and engine availability. |
| `onlycli setup` | Re-run onboarding. |
| `onlycli --version` | Print the version. |

Shared flags for `chat` and `agent`:

| Flag | Description |
| --- | --- |
| `--provider <name>` | `anthropic`, `gemini`, or `openai`. |
| `--model <id>` | Model to use for this run. |
| `--base-url <url>` | Override the OpenAI-compatible endpoint (this run only, not saved). |
| `-f, --file <path>` | Add a file to context. Repeatable. |
| `--scan` | Scan the working directory and add source files. |
| `--no-web` | Disable web search and page fetching. |
| `--max-tokens <n>` | Cap the response length. |
| `--yes` | Apply file changes without asking. |

`agent` additionally accepts `--image <path>` and `--clipboard` to attach an image.

Unquoted prompts work too: `onlycli agent add a jump animation` is joined into one
request rather than being truncated at the first word.

## Slash commands

Inside chat, a line starting with `/` is handled locally and never sent to the model.
To send literal text that begins with `/`, start the line with `//`.

| Command | Description |
| --- | --- |
| `/help` | List all commands. |
| `/pwd`, `/ls [path]` | Show the working directory / list its contents. |
| `/cd <path>` | Change directory. No argument: home directory. |
| `/file <path...>` | Pin a file; it is re-sent as context every turn. |
| `/files`, `/unfile <path\|*>` | List pinned files / unpin one or all. |
| `/scan` | Scan the project and report a summary. |
| `/clear` | Reset chat history (directory, provider, and model are kept). |
| `/provider <name>`, `/model <id>` | Switch provider or model mid-session. Both are remembered for the next run. |
| `/baseurl <url\|reset>` | Change the OpenAI-compatible endpoint. |
| `/apikey` | Change the API key for the current or a chosen provider. |
| `/auto [on\|off]` | Apply file changes without asking for approval. Remembered on this device. |
| `/web [on\|off]` | Toggle web search and page fetching. Default: on. Remembered on this device. |
| `/mcp <engine>` | Connect to a game engine. Aliases: `/connect`, `/engine`. |
| `/mcp list` | List engines and their status. |
| `/mcp status` | Show the active connection and its tool count. |
| `/mcp disconnect` | Close the engine connection. |
| `/status` | Show membership and engine status. Alias: `/info`. |
| `/version` | Print the OnlyCLI version. |
| `/cls` | Clear the screen and redraw the banner. |
| `/exit` | Quit. Ctrl+C also works. |

Multi-line input: end a line with `\` to continue it, or open a block delimiter to paste
several lines at once. Shift+Enter is not usable — cmd.exe and PowerShell cannot
distinguish it from a plain Enter.

## Saved preferences

Session settings you change with a slash command are stored on your own machine, in
`~/.onlycli/config.json`. Nothing about them is sent to a server.

| Command | Stored as |
| --- | --- |
| `/auto [on\|off]` | `preferences.autoApprove` |
| `/web [on\|off]` | `preferences.web` |
| `/provider <name>` | `defaultProvider` |
| `/model <id>` | `models.<provider>` (per provider) |
| `/baseurl <url\|reset>` | `baseUrls.<provider>` |

Startup precedence is: flag for this run > saved preference > built-in default. `--yes` and
`--no-web` therefore stay one-shot and do not rewrite an earlier choice, while `/auto on`
inside chat persists. The model is kept per provider, so switching back to a provider
restores the model you last used with it instead of a global value that may not exist there.

Delete `~/.onlycli/config.json` to reset every preference. API keys are not in that file —
see [where keys are stored](#where-keys-are-stored).

## Approval and `/auto`

By default every file write is shown as a diff and waits for your approval. `/auto on`
(or `--yes`) applies changes immediately — useful for a long build-out session, risky on
an unfamiliar codebase. Without an interactive terminal (piped input, CI) changes cannot
be approved, so they are not applied.

## Providers

| Provider | `--provider` | Key from | Custom endpoint |
| --- | --- | --- | --- |
| Anthropic Claude | `anthropic` | console.anthropic.com | no |
| Google Gemini | `gemini` | aistudio.google.com | no |
| OpenAI / compatible | `openai` | platform.openai.com | yes, `--base-url` |

`--base-url` only applies to `openai`; the Anthropic and Google SDKs use fixed endpoints.
An `http://` endpoint triggers a warning because the key would travel in clear text.

## Game engines over MCP

`/mcp <engine>` starts the engine's MCP server as a child process and speaks to it over
stdio. Once connected, the engine's tools are described to the model, which calls them by
emitting a tool block; OnlyCLI executes the call and feeds the result back.

```
/mcp list            # engines and status
/mcp roblox-studio   # requires Roblox Studio to be open
/mcp godot           # requires Godot 4 and npx
/mcp status          # what is connected and how many tools it exposes
/mcp disconnect
```

### Roblox Studio

1. Open Roblox Studio (recent version, with the built-in MCP server).
2. Open the **Assistant** panel → **... ⟩ Manage MCP Servers** → enable
   **"Enable Studio as MCP server"**.
3. Run `/mcp roblox-studio` in chat. No plugin and no manual token is needed.

Script paths are instance paths without a file extension. `StarterPlayerScripts` and
`StarterCharacterScripts` are children of `StarterPlayer`, not services, so write the
full path: `StarterPlayer/StarterPlayerScripts/Movement`.

Creator Store models are third-party content you cannot review on the approval screen.
Scripts inside inserted models are removed by default and the count is reported, so you
notice when functionality is missing. Backdoors in free models are a real attack vector
in Roblox; keeping a deleted script out is cheap, removing a live backdoor is not.

### Godot 4

Godot support runs the community [godot-mcp](https://github.com/Coding-Solo/godot-mcp)
server via `npx`, pinned to a known version. The first connection downloads it.

The Godot binary is found automatically: `GODOT_PATH` first, then `PATH`, then common
install and download folders (Desktop, Downloads, `%LOCALAPPDATA%\Programs`,
`Program Files\Godot`, the Steam library, `C:\Godot`, and the usual Unix locations plus
`Godot.app`). Among several candidates the highest version wins, then the most stable
channel, then the non-console build. If nothing is found:

```bash
# Windows
setx GODOT_PATH "C:\path\to\Godot_v4.4-stable_win64.exe"

# macOS / Linux
export GODOT_PATH=/path/to/godot
```

Tools exposed by the server:

| Tool | Purpose |
| --- | --- |
| `launch_editor` | Open the Godot editor on a project. |
| `run_project` | Run the project in debug mode. |
| `get_debug_output` | Read stdout/stderr from the running project. |
| `stop_project` | Stop the running project. |
| `get_godot_version` | Report the engine version. |
| `list_projects` | Find Godot projects under a directory. |
| `get_project_info` | Project structure and metadata. |
| `create_scene` | Create a new scene file. |
| `add_node` | Add a node to a scene. |
| `load_sprite` | Load a texture into a Sprite2D/3D. |
| `export_mesh_library` | Export a scene as a `MeshLibrary` resource. |
| `save_scene` | Save a scene, optionally under a new name. |
| `get_uid` | Get the resource UID of a file (Godot 4.4+). |
| `update_project_uids` | Refresh UID references across the project (Godot 4.4+). |

Three things are worth knowing before planning a session around these tools.

**The MCP tools create, they do not revise.** `create_scene` and `add_node` add things;
there is no tool to rename, reconfigure, reparent, or delete an existing node, and none to
delete a scene. Iterating therefore happens through ordinary file editing: `.tscn` is a
readable text format, so OnlyCLI's normal read/write/diff-approval path covers what the
MCP surface cannot.

**Engine path and project path are different things.** `GODOT_PATH` points at the Godot
executable. The paths you pass to the MCP tools are project paths — a project directory is
one containing `project.godot` — while the file tools resolve paths relative to your chat
working directory (`/cd`, `/pwd`).

**Leave `project.godot` to the engine.** Godot rewrites that file itself, so a concurrent
agent edit can be overwritten or leave a conflicting state. For keyboard movement without
touching it, use the built-in `ui_left` / `ui_right` / `ui_up` / `ui_down` actions, which
exist in every project. The tradeoff: arrow keys work out of the box, while WASD needs a
custom input action — which means editing `project.godot`, so add that through the Godot
editor rather than the agent.

Unity and Unreal appear in `/mcp list` but are not implemented yet.

## Web access

The agent can search the web and read pages by default; `--no-web` or `/web off` disables
it. No key is required — the keyless DuckDuckGo path is used. Adding a `BRAVE_API_KEY` or
`TAVILY_API_KEY` (or `onlycli auth search add`) gives more reliable results, since the
keyless path scrapes HTML and is rate-limited.

## Where keys are stored

In priority order:

1. **Environment variable** — `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`.
   Overrides everything. Best for CI.
2. **OS keychain** — via the optional `@napi-rs/keyring` dependency (Keychain,
   Credential Manager, Secret Service). Primary storage when installed.
3. **`~/.onlycli/credentials.json`** — fallback, written with `0600`.

The file fallback stores keys as plain text and the CLI warns when it is used. Encrypting
it with a key kept on the same machine would add no real protection, so it is not done. For
stronger isolation use an environment variable. `onlycli auth list` masks keys; a full key
value is never printed.

Other environment variables:

| Variable | Effect |
| --- | --- |
| `OPENAI_BASE_URL` | Default OpenAI-compatible endpoint. |
| `GODOT_PATH` | Path to the Godot executable. |
| `BRAVE_API_KEY`, `TAVILY_API_KEY` | Web search backends. |
| `ONLYCLI_DEBUG=1` | Print stack traces on error. |
| `ONLYCLI_FIX_PATH=1` | During `npm install -g`, write the PATH line into your shell profile. |
| `ONLYCLI_SKIP_POSTINSTALL=1` | Skip the post-install PATH check. |

## Security behavior

- Files that may hold secrets (`.env`, `credentials.json`, `*.pem`, `*.key`, `.npmrc`) are
  neither added to context nor writable by the agent.
- Agent file paths resolve inside the working directory; `../` and absolute paths that
  escape it are rejected. Your own `/cd` navigation is not restricted — the limit is on the
  agent's authority, not on you.
- No file is written without approval unless you opt out with `/auto` or `--yes`.
- Web text reaches the model as **untrusted data** inside an explicitly delimited block;
  instruction-shaped sentences in it are not obeyed. That is a mitigation, not a
  guarantee — review diffs when the agent has been reading foreign content.
- Page fetching allows only `http`/`https` and rejects `localhost`, private ranges
  (10.x, 192.168.x, 172.16–31.x), link-local `169.254.x` (cloud metadata), and
  single-label hostnames. Addresses are re-checked after each redirect, so a redirect
  cannot walk into the internal network (SSRF).
- URLs with embedded credentials (`user:pass@host`) are rejected. Response size and
  request time are capped; non-text responses are not downloaded.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # emits dist/
```

Run with `ONLYCLI_DEBUG=1` to see stack traces.

The [GitHub repository](https://github.com/OnlyGhostTR/only-cli) publishes the released
artifacts — `dist/`, this README, and `package.json` — the same set that ships in the npm
tarball. The TypeScript sources are not currently public, so `npm run typecheck` and
`npm test` above apply to a working copy of the source tree rather than to a clone of that
repo. Bug reports and feature requests go to
[Issues](https://github.com/OnlyGhostTR/only-cli/issues).

Chat history lives in memory only and is lost when the CLI exits. Multi-model routing,
Unity/Unreal targets, and persistent project memory are not implemented; the provider and
workspace layers are kept separate so they can be added without touching the agent loop.

## License

MIT
