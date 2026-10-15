import { describe, expect, it, vi } from 'vitest';
import { run, type ActionsCore, type PullRequestEvent } from '../src/main.js';

function fakeCore(inputs: Record<string, string>) {
  return {
    getInput: (name: string) => inputs[name] ?? '',
    setSecret: vi.fn(),
    setFailed: vi.fn(),
    setOutput: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  } satisfies ActionsCore;
}

const inputs = { 'api-key': 'sk-secret', 'github-token': 'ghs' };
const repo = { owner: 'o', repo: 'r' };

describe('run', () => {
  it('masks the API key before doing anything else', () => {
    const core = fakeCore(inputs);
    run(core, { eventName: 'pull_request', pullRequest: { number: 1 }, repo });
    expect(core.setSecret).toHaveBeenCalledWith('sk-secret');
  });

  it('fails the step on invalid configuration without throwing', () => {
    const core = fakeCore({ 'github-token': 'ghs', provider: 'nope' });
    expect(run(core, { eventName: 'pull_request', pullRequest: { number: 1 }, repo })).toBeUndefined();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('"provider"'));
  });

  it('skips events without a pull request', () => {
    const core = fakeCore(inputs);
    const event: PullRequestEvent = { eventName: 'push', repo };
    expect(run(core, event)).toMatchObject({ status: 'skipped' });
    expect(core.setOutput).toHaveBeenCalledWith('status', 'skipped');
  });

  it('skips drafts by default but not when skip-draft is false', () => {
    const draft: PullRequestEvent = {
      eventName: 'pull_request',
      pullRequest: { number: 7, draft: true },
      repo,
    };
    expect(run(fakeCore(inputs), draft)).toMatchObject({ status: 'skipped' });
    expect(run(fakeCore({ ...inputs, 'skip-draft': 'false' }), draft)).toMatchObject({
      status: 'ready',
      pullNumber: 7,
    });
  });
});
