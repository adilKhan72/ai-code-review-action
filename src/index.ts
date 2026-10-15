import * as core from '@actions/core';
import * as github from '@actions/github';
import { reviewPullRequest } from './engine.js';
import { gitHubApi } from './github.js';
import { run } from './main.js';
import { createProvider } from './providers/index.js';

async function main(): Promise<void> {
  const payload = github.context.payload;
  const prepared = run(core, {
    eventName: github.context.eventName,
    pullRequest: payload.pull_request
      ? { number: payload.pull_request.number, draft: payload.pull_request['draft'] === true }
      : undefined,
    repo: github.context.repo,
  });
  if (prepared?.status !== 'ready') return;

  const { config, pullNumber } = prepared;
  const outcome = await reviewPullRequest(
    {
      github: gitHubApi(github.getOctokit(config.githubToken), github.context.repo, pullNumber),
      provider: createProvider(config),
      log: core,
    },
    config,
  );

  core.setOutput('status', outcome.status);
  if (outcome.status === 'skipped') {
    core.info(`Skipping: ${outcome.reason}.`);
    return;
  }
  core.setOutput('inline-comments', outcome.inline);
  core.setOutput('summary-findings', outcome.offDiff);
  core.setOutput('test-suggestions', outcome.testSuggestions);
  if (outcome.url) {
    core.setOutput('review-url', outcome.url);
    core.info(`Review posted: ${outcome.url}`);
  }
  core.info(
    `Done: ${String(outcome.inline)} inline, ${String(outcome.offDiff)} in summary, ` +
      `${String(outcome.testSuggestions)} test suggestions, ` +
      `${String(outcome.usage.inputTokens)}/${String(outcome.usage.outputTokens)} tokens in/out.`,
  );
}

main().catch((err: unknown) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
