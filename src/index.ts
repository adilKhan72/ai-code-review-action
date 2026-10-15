import * as core from '@actions/core';
import * as github from '@actions/github';
import { run } from './main.js';

const payload = github.context.payload;

try {
  const result = run(core, {
    eventName: github.context.eventName,
    pullRequest: payload.pull_request
      ? { number: payload.pull_request.number, draft: payload.pull_request['draft'] === true }
      : undefined,
    repo: github.context.repo,
  });
  if (result?.status === 'ready') {
    core.warning('The review engine is not implemented yet (Milestone 2). No review was posted.');
    core.setOutput('status', 'not-implemented');
  }
} catch (err) {
  core.setFailed(err instanceof Error ? err.message : String(err));
}
