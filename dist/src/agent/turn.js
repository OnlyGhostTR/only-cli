/**
 * Single agent turn: send request, stream response, present proposed changes.
 *
 * Both one-off `onlycli agent "..."` calls and interactive chat use this
 * function; this way the two paths don't diverge in behavior.
 */
import { select } from "@inquirer/prompts";
import * as ui from "../ui/components.js";
import { StreamView } from "../ui/stream.js";
import { buildDiff, diffStats } from "../utils/diff.js";
import { formatWorkspaceContext, } from "../workspace/base.js";
import { DiskWorkspace } from "../workspace/disk.js";
import { parseResponse } from "./edits.js";
import { buildSystemPrompt, buildUserMessage } from "./prompt.js";
import { formatToolResults, MAX_TOOL_STEPS, MAX_MCP_TOOL_STEPS, parseToolRequests, runToolRequest, } from "./tools.js";
/**
 * Reads resources to include in context.
 *
 * Protected paths are not silently skipped: user should see which files are
 * excluded and why, otherwise it's hard to notice when the model's answer
 * lacks context.
 */
export async function collectContext(options) {
    const { workspace } = options;
    const safe = options.files.filter((path) => !workspace.isProtected(path));
    for (const path of options.files.filter((p) => workspace.isProtected(p))) {
        ui.warn(`${path} not added to context: may contain secrets.`);
    }
    const files = safe.length > 0 ? await workspace.read(safe) : [];
    if (options.scan)
        files.push(...(await workspace.scan()));
    // Pinned file and scan result may overlap; sending the same content twice
    // wastes tokens and confuses the model.
    const seen = new Set();
    return files.filter((file) => {
        if (seen.has(file.path))
            return false;
        seen.add(file.path);
        return true;
    });
}
export async function runTurn(options) {
    const { provider, session } = options;
    // Type is explicit: `??` would otherwise produce `Workspace | DiskWorkspace`
    // union and make optional interface members (applyScene) inaccessible.
    const workspace = options.workspace ?? new DiskWorkspace(session.cwd);
    const requested = [...session.pinnedFiles, ...(options.files ?? [])];
    // Same file may be given both pinned and via --file.
    const unique = [...new Set(requested)];
    const contexts = await collectContext({
        workspace,
        files: unique,
        scan: options.scan === true,
    });
    const context = formatWorkspaceContext(contexts);
    if (contexts.length > 0) {
        ui.hint(`${contexts.length} files added to context: ${contexts
            .map((file) => file.path)
            .join(", ")}`);
    }
    session.addUserMessage(buildUserMessage({ prompt: options.prompt, context }));
    const webEnabled = options.web ?? session.webEnabled;
    // AI rules (not workspace-specific anymore)
    let aiRules;
    const controller = new AbortController();
    const onSigint = () => controller.abort();
    process.once("SIGINT", onSigint);
    const system = buildSystemPrompt({
        cwd: workspace.label,
        hasContext: contexts.length > 0,
        interactive: true,
        guidance: workspace.promptGuidance(),
        web: webEnabled,
        aiRules,
        mcpTools: session.mcpConnection?.tools || [],
    });
    let full = "";
    let usage;
    let aborted = false;
    let toolSteps = 0;
    let webToolSteps = 0;
    let mcpToolSteps = 0;
    try {
        /*
         * Tool loop: when model writes a search/fetch block, we add the result
         * to history and ask again in the same turn. Step limit prevents the model
         * from building an endless search chain and silently burning the user's
         * token budget.
         */
        for (let step = 0;; step++) {
            let round;
            try {
                round = await streamOnce({
                    provider,
                    messages: session.messages,
                    system,
                    model: session.model,
                    ...(options.maxTokens !== undefined
                        ? { maxTokens: options.maxTokens }
                        : {}),
                    signal: controller.signal,
                    ...(session.mcpConnection && session.mcpConnection.tools.length > 0
                        ? { mcpTools: session.mcpConnection.tools }
                        : {}),
                });
            }
            catch (streamError) {
                // Abort always propagates up; if user cancelled, we shouldn't silently
                // swallow the turn.
                if (controller.signal.aborted)
                    throw streamError;
                // Network error shouldn't kill the turn: instead of resetting all streams,
                // we skip this step and exit the tool loop. User sees what happened at
                // turn end.
                ui.warn(`Connection issue, this step was skipped: ${streamError instanceof Error ? streamError.message : String(streamError)}`);
                break;
            }
            full = round.text;
            // We show total, not last turn's usage; if the tool loop made multiple
            // requests, one turn's count would be misleading.
            if (round.usage) {
                usage = usage
                    ? {
                        inputTokens: usage.inputTokens + round.usage.inputTokens,
                        outputTokens: usage.outputTokens + round.usage.outputTokens,
                    }
                    : round.usage;
            }
            session.addAssistantMessage(round.text);
            // Check for native tool calls (from provider's tool calling API)
            if (round.text.startsWith('TOOL_CALL:')) {
                const parts = round.text.split(':');
                if (parts.length >= 3) {
                    const toolName = parts[1];
                    const argsJson = parts.slice(2).join(':');
                    if (!toolName) {
                        ui.warn('Invalid tool call: missing tool name');
                    }
                    else {
                        try {
                            const args = JSON.parse(argsJson);
                            const mcpRequest = {
                                kind: 'mcp',
                                toolName,
                                arguments: args,
                            };
                            ui.blank();
                            const spinner = new ui.Spinner(`calling tool: ${toolName}`).start();
                            const outcome = await runToolRequest(mcpRequest, {
                                signal: controller.signal,
                                mcpConnection: session.mcpConnection,
                            });
                            spinner.stop();
                            if (outcome.ok) {
                                ui.hint(`mcp · ${outcome.summary}`);
                            }
                            else {
                                ui.failure(`mcp · ${outcome.summary}`);
                            }
                            // Add tool result to history
                            const resultMessage = formatToolResults([outcome]);
                            session.addUserMessage(resultMessage);
                            // Continue the loop to get next response
                            continue;
                        }
                        catch (error) {
                            ui.warn(`Failed to parse native tool call: ${error instanceof Error ? error.message : 'Unknown error'}`);
                        }
                    }
                }
            }
            const parsed = parseToolRequests(round.text);
            /*
             * Asset search works even with `/web off`.
             *
             * Web tool refreshes model's general knowledge.
             */
            const requests = parsed.requests.filter((request) => webEnabled);
            // Note makes sense only if we're actually running the request; showing it
            // when there are none would be confusing.
            if (requests.length > 0) {
                for (const note of parsed.notes)
                    ui.warn(note);
            }
            if (requests.length === 0)
                break;
            // Separate limits for web and MCP tools
            const mcpRequests = requests.filter(r => r.kind === 'mcp');
            const webRequests = requests.filter(r => r.kind !== 'mcp');
            // Check web tool limit
            if (webRequests.length > 0 && webToolSteps + 1 >= MAX_TOOL_STEPS) {
                ui.warn(`Web tool step limit reached (${MAX_TOOL_STEPS}); remaining web requests were not run.`);
                // Still allow MCP requests to continue
                if (mcpRequests.length === 0)
                    break;
            }
            // Check MCP tool limit (should never hit Infinity, but keep the check)
            if (mcpRequests.length > 0 && mcpToolSteps + 1 >= MAX_MCP_TOOL_STEPS) {
                ui.warn(`MCP tool step limit reached (${MAX_MCP_TOOL_STEPS}); remaining MCP requests were not run.`);
                // Still allow web requests to continue
                if (webRequests.length === 0)
                    break;
            }
            ui.blank();
            const outcomes = [];
            for (const request of requests) {
                // Skip web requests if limit reached
                if (request.kind !== 'mcp' && webToolSteps >= MAX_TOOL_STEPS) {
                    continue;
                }
                // Skip MCP requests if limit reached (shouldn't happen with Infinity)
                if (request.kind === 'mcp' && mcpToolSteps >= MAX_MCP_TOOL_STEPS) {
                    continue;
                }
                const spinner = new ui.Spinner(request.kind === "search"
                    ? `searching: ${request.query}`
                    : request.kind === "fetch"
                        ? `fetching: ${request.url}`
                        : `calling tool: ${request.toolName}`).start();
                const outcome = await runToolRequest(request, {
                    signal: controller.signal,
                    mcpConnection: session.mcpConnection,
                });
                spinner.stop();
                // Update counters
                if (request.kind === 'mcp') {
                    mcpToolSteps++;
                }
                else {
                    webToolSteps++;
                }
                // Label reflects tool type.
                const label = request.kind === "mcp" ? "mcp" : "web";
                if (outcome.ok) {
                    ui.hint(`${label} · ${outcome.summary}`);
                }
                else {
                    ui.warn(`${label} · ${outcome.summary}`);
                }
                outcomes.push(outcome);
            }
            ui.blank();
            toolSteps++;
            session.addUserMessage(formatToolResults(outcomes));
        }
    }
    catch (error) {
        // Turn interrupted by Ctrl+C shouldn't enter history half-baked.
        session.dropLastMessage();
        if (controller.signal.aborted) {
            aborted = true;
            ui.warn("Request cancelled.");
            return {
                text: full,
                appliedEdits: 0,
                proposedEdits: 0,
                toolSteps,
                aborted,
            };
        }
        throw error;
    }
    finally {
        process.removeListener("SIGINT", onSigint);
    }
    const { edits } = parseResponse(full);
    // Parse scene blocks only if target supports them. If model wrote one on
    // disk target, that's a prompt deviation; tell user rather than silently
    // ignoring.
    for (const error of edits)
        ui.warn(`Edit block issue — ${error}`);
    if (usage) {
        ui.statusLine([ui.usageSummary(usage)]);
    }
    if (edits.length === 0) {
        return {
            text: full,
            appliedEdits: 0,
            proposedEdits: 0,
            toolSteps,
            aborted,
        };
    }
    let applied = 0;
    if (edits.length > 0) {
        ui.blank();
        ui.rule(`${edits.length} changes proposed`);
        for (const edit of edits) {
            if (await applyEdit(edit, workspace, session.autoApprove))
                applied++;
        }
        ui.blank();
        if (applied > 0) {
            ui.success(`${applied}/${edits.length} changes applied.`);
        }
        else {
            ui.hint("No changes applied.");
        }
    }
    return {
        text: full,
        appliedEdits: applied,
        proposedEdits: edits.length,
        toolSteps,
        aborted,
    };
}
/**
 * Stream a single model request and return full text.
 *
 * Separate function because of the tool loop: called multiple times in
 * the same turn, and each call needs its own spinner and markdown stream.
 */
async function streamOnce(options) {
    // Wait for first chunk is indefinite; without spinner CLI looks frozen.
    const spinner = new ui.Spinner("awaiting response").start();
    let spinning = true;
    const stopSpinner = () => {
        if (spinning) {
            spinner.stop();
            spinning = false;
        }
    };
    const view = new StreamView();
    let text = "";
    let usage;
    try {
        const stream = options.provider.chatStream(options.messages, {
            system: options.system,
            model: options.model,
            ...(options.maxTokens !== undefined
                ? { maxTokens: options.maxTokens }
                : {}),
            signal: options.signal,
            ...(options.mcpTools && options.mcpTools.length > 0
                ? { mcpTools: options.mcpTools }
                : {}),
        });
        for await (const chunk of stream) {
            if (chunk.type === "text") {
                stopSpinner();
                text += chunk.text;
                view.push(chunk.text);
            }
            else if (chunk.type === "done") {
                usage = chunk.response.usage;
            }
        }
        return { text, usage };
    }
    finally {
        stopSpinner();
        view.end();
    }
}
/** Display diff, request approval, and write to target if approved. */
export async function applyEdit(edit, workspace, autoApprove) {
    if (workspace.isProtected(edit.path)) {
        ui.failure(`${edit.path} skipped: files that may contain secrets cannot be modified by agent.`);
        return false;
    }
    let before;
    try {
        before = await workspace.readCurrent(edit.path);
    }
    catch (error) {
        // Sandbox breach and unreadable target both land here: attempting write in
        // either case would be wrong.
        ui.failure(`${edit.path} skipped: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
    const exists = before !== null;
    const current = before ?? "";
    if (current === edit.content || current === withTrailingNewline(edit.content)) {
        ui.hint(`${edit.path} — no change`);
        return false;
    }
    const patch = buildDiff(edit.path, current, edit.content);
    const stats = diffStats(patch);
    ui.blank();
    ui.fileHeader(exists ? edit.path : `${edit.path} (new)`, stats);
    ui.printDiff(patch);
    if (!autoApprove) {
        if (!process.stdin.isTTY) {
            ui.warn(`No interactive terminal; ${edit.path} not written. Use --yes to apply.`);
            return false;
        }
        const answer = await select({
            message: `Write ${edit.path}?`,
            choices: [
                { name: "Yes, apply", value: "yes" },
                { name: "No, skip", value: "no" },
            ],
        });
        if (answer === "no") {
            ui.hint(`${edit.path} skipped.`);
            return false;
        }
    }
    try {
        const result = await workspace.write(edit.path, edit.content);
        ui.success(`${result.path} written.`);
        return true;
    }
    catch (error) {
        ui.failure(`${edit.path} failed to write: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}
function withTrailingNewline(content) {
    return content.endsWith("\n") ? content : `${content}\n`;
}
//# sourceMappingURL=turn.js.map