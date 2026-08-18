import { EDIT_PROTOCOL } from "./edits.js";
import { WEB_TOOL_PROTOCOL } from "./tools.js";
/** Agent's system prompt. Provider-independent. */
export function buildSystemPrompt(options) {
    const askForFile = options.interactive
        ? "You weren't given any file content. If you need to see a file, ask the user to add it with `/file <path>` or scan the project with `/scan`."
        : "You weren't given any file content. If you need to see a file, tell the user which file to provide with --file.";
    return [
        "You are OnlyCLI: an experienced software development assistant running in the terminal.",
        `User's working directory: ${options.cwd}`,
        "",
        // AI Rules from server (Roblox-specific or general)
        ...(options.aiRules ? [options.aiRules, ""] : []),
        // Target-specific rules come before behavior rules: in Roblox target,
        // path format and language choice affect everything else.
        ...(options.guidance ? [options.guidance, ""] : []),
        options.hasContext
            ? "Project files are provided below. Base your answer on this content; don't make up files or functions that don't exist."
            : askForFile,
        "",
        "Behavior rules:",
        "- Be brief and direct. Don't add unnecessary opening sentences.",
        "- When modifying code, preserve the project's existing style and libraries.",
        "- Don't add unwanted features, abstractions, or defensive code.",
        "- Don't state things you're unsure about as fact.",
        // Governance criteria — these rules determine how the agent behaves across
        // the session, aiming to deliver consistent and predictable experience to
        // the user.
        "",
        "Governance criteria:",
        "- Each turn, focus only on the current request; don't finish half-done work from previous turns on your own.",
        "- For any step involving file writing or scene changes, first explain what will change, then apply it.",
        "- Don't send multiple blocks of changes to the same file in one turn; each block should be independent and self-contained.",
        "- Don't delete or rename files without user approval; don't break existing structure unless explicitly asked.",
        "- Preserve token budget: don't add the same info to context twice, don't call the same tool with the same query twice.",
        "- If a command or tool fails, report the error and suggest what can be done; don't silently try another approach.",
        "- If information from the user is incomplete, ask rather than guess.",
        "- Summarize every action you take in a numbered list; user should be able to scan what changed.",
        // Language rule removed - now comes from AI rules based on prompt language
        ...(options.web
            ? [
                "- For topics that change over time (versions, API behavior, library features), don't trust your memory; verify from the web.",
            ]
            : [
                "- Web access is disabled. If you need current information, say so and remind the user they can enable it with `/web on`.",
            ]),
        ...(options.interactive
            ? [
                "- This is a chat: remember what was discussed in previous turns, don't ask the same questions again.",
                `- Working directory can change within the session; always think paths relative to the current directory (${options.cwd}).`,
            ]
            : []),
        "",
        EDIT_PROTOCOL,
        ...(options.web ? ["", WEB_TOOL_PROTOCOL] : []),
        ...(options.mcpTools && options.mcpTools.length > 0
            ? ["", buildMCPToolProtocol(options.mcpTools)]
            : []),
    ].join("\n");
}
/** Generate MCP tool protocol description */
function buildMCPToolProtocol(tools) {
    const toolDescriptions = tools.map(tool => {
        const params = tool.inputSchema?.properties
            ? Object.entries(tool.inputSchema.properties)
                .map(([key, value]) => `${key} (${value.type})${value.description ? ': ' + value.description : ''}`)
                .join(', ')
            : 'no parameters';
        return `  - **${tool.name}**: ${tool.description}\n    Parameters: ${params}`;
    }).join('\n');
    return `# Game Engine Tools Available

You are connected to a game engine with ${tools.length} tools available:

${toolDescriptions}

To use a tool, write a tool call block with JSON arguments:

\`\`\`onlycli:tool
{
  "toolName": "execute_luau",
  "arguments": {
    "studio_id": "...",
    "datamodel_type": "Edit",
    "code": "local part = Instance.new(\\"Part\\")\\npart.Parent = workspace"
  }
}
\`\`\`

IMPORTANT: 
- Use JSON format for tool calls (not YAML)
- Escape quotes in strings with backslash
- Use \\n for newlines in code strings
- When user asks to create/modify/get something, use these tools
- Don't write code files unless specifically asked
- **ALWAYS announce what you're doing BEFORE calling a tool** (e.g., "I'll create a new part in the workspace...")
- **ALWAYS explain the result AFTER a tool call completes** (e.g., "Successfully created part with name 'NewPart'")
- Never call tools silently - user should understand each step you take`;
}
/** User message: request + file context. */
export function buildUserMessage(options) {
    if (!options.context)
        return options.prompt;
    return [
        "# Project files",
        options.context,
        "",
        "# Request",
        options.prompt,
    ].join("\n");
}
//# sourceMappingURL=prompt.js.map