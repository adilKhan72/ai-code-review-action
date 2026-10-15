import type { getOctokit } from '@actions/github';
import type { ReviewPayload } from './review/payload.js';
import type { PrFile } from './types.js';

export interface PullRequestInfo {
  number: number;
  headSha: string;
  baseSha: string;
  title: string;
  body: string;
  draft: boolean;
}

/** The GitHub operations the engine needs. An interface, so the engine can be tested without HTTP. */
export interface GitHubApi {
  getPullRequest(): Promise<PullRequestInfo>;
  listFiles(): Promise<PrFile[]>;
  createReview(review: ReviewPayload): Promise<{ url: string }>;
  /** File text at a commit, or undefined if the file does not exist there. */
  getFileContent(path: string, ref: string): Promise<string | undefined>;
  /** Names of the files (not directories) in a directory at a commit; empty if it does not exist. */
  listDirectory(path: string, ref: string): Promise<string[]>;
  /** Bodies of review comments and review summaries on this PR written by `login`. */
  listBodiesBy(login: string): Promise<string[]>;
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
        baseSha: data.base.sha,
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
    async getFileContent(path, ref) {
      try {
        const { data } = await octokit.rest.repos.getContent({ ...repo, path, ref });
        if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return undefined;
        return Buffer.from(data.content, 'base64').toString('utf8');
      } catch (err) {
        if (typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 404)
          return undefined;
        throw err;
      }
    },
    async listDirectory(path, ref) {
      try {
        const { data } = await octokit.rest.repos.getContent({ ...repo, path, ref });
        return Array.isArray(data) ? data.filter((e) => e.type === 'file').map((e) => e.name) : [];
      } catch (err) {
        if (typeof err === 'object' && err !== null && (err as { status?: unknown }).status === 404)
          return [];
        throw err;
      }
    },
    async listBodiesBy(login) {
      const [comments, reviews] = await Promise.all([
        octokit.paginate(octokit.rest.pulls.listReviewComments, { ...pr, per_page: 100 }),
        octokit.paginate(octokit.rest.pulls.listReviews, { ...pr, per_page: 100 }),
      ]);
      return [...comments, ...reviews].filter((item) => item.user?.login === login).map((item) => item.body);
    },
  };
}
