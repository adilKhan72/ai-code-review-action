import { ConfigError, readConfig, type Config } from './config.js';

/** The slice of `@actions/core` the action uses, so tests can pass a fake. */
export interface ActionsCore {
  getInput(name: string): string;
  setSecret(secret: string): void;
  setFailed(message: string): void;
  setOutput(name: string, value: string | number): void;
  info(message: string): void;
  warning(message: string): void;
}

/** The parts of the webhook payload this action reads. */
export interface PullRequestEvent {
  eventName: string;
  pullRequest?: { number: number; draft?: boolean } | undefined;
  repo: { owner: string; repo: string };
}

export type RunResult =
  { status: 'skipped'; reason: string } | { status: 'ready'; config: Config; pullNumber: number };

export function run(core: ActionsCore, event: PullRequestEvent): RunResult | undefined {
  let config: Config;
  try {
    config = readConfig((name) => core.getInput(name));
  } catch (err) {
    if (err instanceof ConfigError) {
      core.setFailed(err.message);
      return undefined;
    }
    throw err;
  }
  // Mask before anything is logged. GitHub masks secrets passed via `secrets.*`, but not values from other sources.
  if (config.apiKey) core.setSecret(config.apiKey);

  const pr = event.pullRequest;
  if (!pr) {
    return skip(core, `event "${event.eventName}" has no pull request; nothing to review`);
  }
  if (pr.draft && config.skipDraft) {
    return skip(core, `PR #${pr.number} is a draft and skip-draft is true`);
  }

  core.info(
    `Reviewing ${event.repo.owner}/${event.repo.repo}#${pr.number} with ${config.provider}/${config.model}` +
      (config.dryRun ? ' (dry run)' : ''),
  );
  return { status: 'ready', config, pullNumber: pr.number };
}

function skip(core: ActionsCore, reason: string): RunResult {
  core.info(`Skipping: ${reason}.`);
  core.setOutput('status', 'skipped');
  return { status: 'skipped', reason };
}
