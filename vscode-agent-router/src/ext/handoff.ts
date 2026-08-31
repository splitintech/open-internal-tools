import * as vscode from "vscode";
import { encodeClaudeHandoffUri } from "../adapters/claude";

const CLAUDE_EXT = "anthropic.claude-code";
const CODEX_EXT = "openai.chatgpt";

export function editorPrompt(fallbackTitle: string): string | undefined {
  const editor = vscode.window.activeTextEditor;
  const selected = editor?.document.getText(editor.selection);
  if (selected && selected.trim()) return selected;
  return undefined;
}

async function promptOrSelection(title: string): Promise<string | undefined> {
  const fromEditor = editorPrompt(title);
  if (fromEditor) return fromEditor;
  return vscode.window.showInputBox({ title, prompt: "Prompt to send" });
}

export async function ensureExtension(
  id: string,
  label: string,
): Promise<boolean> {
  if (vscode.extensions.getExtension(id)) return true;
  const action = await vscode.window.showErrorMessage(
    `${label} is not installed (${id}).`,
    "Open Extensions",
  );
  if (action === "Open Extensions") {
    await vscode.commands.executeCommand("workbench.extensions.search", id);
  }
  return false;
}

export async function handoffClaude(prompt?: string): Promise<void> {
  if (!(await ensureExtension(CLAUDE_EXT, "Claude Code"))) return;
  const text = prompt ?? (await promptOrSelection("Handoff to Claude Code"));
  if (!text) return;
  const uri = vscode.Uri.parse(encodeClaudeHandoffUri(text));
  await vscode.env.openExternal(uri);
  void vscode.window.showInformationMessage(
    "Opened Claude Code with a prefilled prompt. It does not auto-submit.",
  );
}

export async function handoffCodex(prompt?: string): Promise<void> {
  if (!(await ensureExtension(CODEX_EXT, "Codex"))) return;
  const text = prompt ?? (await promptOrSelection("Add to Codex"));
  if (!text) return;
  try {
    await vscode.commands.executeCommand("chatgpt.addToThread", text);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Codex handoff failed. Is openai.chatgpt enabled? ${(err as Error).message}`,
    );
  }
}

export async function handoffCodexFile(uri?: vscode.Uri): Promise<void> {
  if (!(await ensureExtension(CODEX_EXT, "Codex"))) return;
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target) {
    vscode.window.showErrorMessage("No file selected for Codex.");
    return;
  }
  try {
    await vscode.commands.executeCommand("chatgpt.addFileToThread", target);
  } catch (err) {
    vscode.window.showErrorMessage(
      `Codex add-file failed: ${(err as Error).message}`,
    );
  }
}

export async function probeCursorHandoff(): Promise<string | undefined> {
  const commands = await vscode.commands.getCommands(true);
  return commands.find(
    (name) =>
      name === "composer.newAgentChat" ||
      name === "cursor.startComposerPrompt" ||
      name === "workbench.action.chat.open",
  );
}
