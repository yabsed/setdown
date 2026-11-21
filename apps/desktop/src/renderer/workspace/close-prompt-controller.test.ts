import { beforeEach, expect, test, vi } from 'vitest';
import type { CloseDecision } from '../../protocol/desktop-api';
// The shell's view state is a rune module; here it is the plain object the controller writes to.
vi.mock('./workspace-view.svelte', () => ({ view: { closePrompt: null } }));
import { ClosePromptController } from './close-prompt-controller';
import { view } from './workspace-view.svelte';

beforeEach(() => { view.closePrompt = null; });

test('without a layer the shell asks, one question at a time and in order', async () => {
  const prompts = new ClosePromptController();
  const first = prompts.request('tab', ['a.md', ' a.md ', '']), second = prompts.request('window', ['b.md']);
  expect(view.closePrompt).toEqual({ scope: 'tab', names: ['a.md'] });
  prompts.resolve('cancel');
  expect(await first).toBe('cancel');
  expect(view.closePrompt).toEqual({ scope: 'window', names: ['b.md'] });
  prompts.resolve('save');
  expect(await second).toBe('save'); expect(view.closePrompt).toBeNull();
});

test('above a live web page the layer asks and the shell shows no dialog of its own', async () => {
  const answers: ((decision: CloseDecision | null) => void)[] = [];
  const layer = vi.fn(() => new Promise<CloseDecision | null>(resolve => answers.push(resolve)));
  const prompts = new ClosePromptController(layer);
  const first = prompts.request('window', ['notes.md']), second = prompts.request('tab', ['other.md']);
  expect(layer).toHaveBeenCalledTimes(1); expect(layer).toHaveBeenLastCalledWith({ scope: 'window', names: ['notes.md'] });
  expect(view.closePrompt).toBeNull();
  answers[0]('discard');
  expect(await first).toBe('discard');
  // The next question is asked only now, again in the layer.
  expect(layer).toHaveBeenCalledTimes(2); expect(layer).toHaveBeenLastCalledWith({ scope: 'tab', names: ['other.md'] });
  expect(view.closePrompt).toBeNull();
  answers[1]('cancel');
  expect(await second).toBe('cancel');
});

test('where no web page is showing, or the layer fails, the shell asks in its own dialog', async () => {
  const layer = vi.fn<() => Promise<CloseDecision | null>>().mockResolvedValueOnce(null).mockRejectedValueOnce(Error('no layer'));
  const prompts = new ClosePromptController(layer);
  const first = prompts.request('tab', ['a.md']);
  await vi.waitFor(() => expect(view.closePrompt).toEqual({ scope: 'tab', names: ['a.md'] }));
  prompts.resolve('save'); expect(await first).toBe('save'); expect(view.closePrompt).toBeNull();
  const second = prompts.request('tab', ['b.md']);
  await vi.waitFor(() => expect(view.closePrompt).toEqual({ scope: 'tab', names: ['b.md'] }));
  prompts.resolve('cancel'); expect(await second).toBe('cancel');
});

test('an answer of the layer that comes after the question was settled changes nothing', async () => {
  let answer!: (decision: CloseDecision | null) => void;
  const prompts = new ClosePromptController(() => new Promise(resolve => { answer = resolve; }));
  const first = prompts.request('tab', ['a.md']);
  prompts.resolve('cancel'); expect(await first).toBe('cancel');
  answer('discard'); await Promise.resolve(); await Promise.resolve();
  expect(view.closePrompt).toBeNull();
});
