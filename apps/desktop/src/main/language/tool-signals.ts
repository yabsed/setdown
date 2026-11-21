import type { ClientCapabilities } from 'vscode-languageserver-protocol';

// A tool's own editor extension listens to notifications the protocol has no name for, and
// answers requests only that tool makes. VS Code shows what they say in a status bar item, a
// notification with buttons or an output channel. Setdown shows the same facts in the document
// panel. This file is the form those facts take here, so that the rules carried over from each
// extension (`java-signals.ts`, `kotlin-signals.ts`, …) are plain functions from what the tool
// said to what the person is shown, and can be tested without a tool or a window.

/** What a button of a notice does when the person chooses it. Exactly one of the effect keys is
 * set. `next` is done after it, when the effect succeeded: a command must also have answered
 * something (an extension's "upgrade, then import again"), and a changed setting starts the tool
 * again, which leaves nothing to follow. */
export type ToolAction = { title: string; next?: ToolAction } & (
  /** Sent to the tool as `workspace/executeCommand`. */
  | { command: { command: string; arguments?: unknown[] } }
  /** A notification sent to the tool. */
  | { notify: { method: string; params?: unknown } }
  /** A request sent to the tool; its answer is not shown. */
  | { request: { method: string; params?: unknown } }
  /** Written into the tool's settings for this project, by its VS Code name (`java.import.gradle.java.home`).
   * `then`: start the tool again, or leave it running because it reads settings as they change. */
  | { setting: { name: string; value: unknown; then?: 'restart' } }
  /** An https page, opened in the browser. */
  | { link: string }
  /** Starts the tool again. */
  | { restart: true }
  /** Only removes the notice. */
  | { dismiss: true });

/** A notice that stays in the document panel until the person answers or dismisses it. */
export type ToolNotice = { severity: 'error' | 'warning' | 'info'; message: string; actions?: ToolAction[] };

/** What one message of a tool changes in what the person is shown. Every key is optional;
 * a value of `undefined` under a name removes what an earlier signal put there. */
export type ToolSignal = {
  /** Named lines of the tool's context in the document panel: `{ 'Java project': 'Imported' }`. */
  context?: Record<string, string | undefined>;
  /** Work in progress, by a key the rule chooses. While any is present the tool counts as working. */
  progress?: Record<string, string | undefined>;
  /** Standing notices, by a key the rule chooses. The same key with a changed notice replaces it;
   * a notice the person dismissed returns only when its text changes. */
  notices?: Record<string, ToolNotice | undefined>;
  /** Lines for the tool's log in Language Support. */
  log?: string[];
};

/** What a tool gets back for one of its own requests. Either the answer at once, or a question
 * the person is asked in the document panel first: `result` then makes the answer from the
 * number of their choice, or from `undefined` when they dismissed the question or it ran out
 * of time. `signal` is shown as for a notification. */
export type ToolAnswer = { result: unknown; signal?: ToolSignal }
  | { question: { message: string; answers: string[] }; result(answer: number | undefined): unknown; signal?: ToolSignal };

/** The rules of one running tool. A rule may keep state between calls: one object is made for
 * each session of the tool (`ToolRulesFactory`). */
export type ToolRules = {
  /** What the tool's extension declares beyond what every tool is told. Returns the whole capabilities. */
  capabilities?(general: ClientCapabilities): ClientCapabilities;
  /** What the extension adds to the initialization options. What the person wrote there wins. */
  initializationOptions?: Record<string, unknown>;
  /** Once, when the tool has answered `initialize`. */
  started?(): ToolSignal | undefined;
  /** Notifications the extension sends once the tool has started. `params` is the one parameter, as a language client is given it. */
  announces?: { method: string; params?: unknown }[];
  /** Requests the extension sends once the tool has started, and what each answer means. */
  queries?: { method: string; params?: unknown }[];
  answered?(method: string, result: unknown): ToolSignal | undefined;
  /** What each of the tool's own notifications means. */
  notifications?: Record<string, (params: unknown) => ToolSignal | undefined>;
  /** The tool's own requests to its editor: the answer it gets, and what the person is shown. */
  requests?: Record<string, (params: unknown) => ToolAnswer | Promise<ToolAnswer>>;
  /** The tool's notifications that are questions for another tool of the same project, which its
   * editor passes on. `ask` sends that tool a request and rejects when the project has none that
   * runs. What the rule returns is sent back to this tool as notifications; it always answers,
   * with nothing where the other tool has none, so that this tool never waits for good. */
  relays?: Record<string, (params: unknown, ask: AskTool) => Promise<{ method: string; params: unknown }[]>>;
};
/** Asks the project's tool of a family (`extension-rules.ts`, `toolFamily`) and resolves with its answer. */
export type AskTool = (tool: string, method: string, params: unknown) => Promise<unknown>;

/** `name`: the tool's name as the person sees it. `root`: the project folder the tool was started
 * in. `settings`: the tool's settings as written for this project, by their VS Code names, nested
 * or dotted (`extension-rules.ts` `setting` reads both). */
export type ToolRulesFactory = (context: { name: string; root: string; settings: Record<string, unknown> }) => ToolRules;
