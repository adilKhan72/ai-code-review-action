import type { getOctokit } from '@actions/github';
import type { ReviewPayload } from './review/payload.js';
import type { PrFile } from './types.js';

export interface PullRequestInfo {
  number: number;
  headSha: string;
  title: string;
  body: string;
  draft: boolean;
}

/** The GitHub operations the engine needs. An interface, so the engine can be tested without HTTP. */
export interface GitHubApi {
  getPullRequest(): Promise<PullRequestInfo>;
  listFiles(): Promise<PrFile[]>;
  createReview(review: ReviewPayload): Promise<{ url: string }>;
}

type Octokit = ReturnType<typeof getOctokit>;

export function gitHubApi(
  octokit: Octokit,
  repo: { owner: string; repo: string },
  pullNumber: number,
): GitHubApi {
  const pr = { ...repo, pull_number: pullNumber };
  return {
    async getPullRequest() {
      const { data } = await octokit.rest.pulls.get(pr);
      return {
        number: data.number,
        headSha: data.head.sha,
        title: data.title,
        body: data.body ?? '',
        draft: data.draft === true,
      };
    },
    async listFiles() {
      // The endpoint returns at most 3000 files; the max-files guardrail is far below that.
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, { ...pr, per_page: 100 });
      return files.map((f) => ({ filename: f.filename, status: f.status, patch: f.patch }));
    },
    async createReview(review) {
      const { data } = await octokit.rest.pulls.createReview({ ...pr, ...review });
      return { url: data.html_url };
    },
  };
}
