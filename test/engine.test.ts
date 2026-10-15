import { describe, expect, it, vi, type Mock } from 'vitest';
import { DEFAULT_EXCLUDE, type Config } from '../src/config.js';
import { reviewPullRequest, type EngineDeps } from '../src/engine.js';
import type { GitHubApi, PullRequestInfo } from '../src/github.js';
import { ProviderError, type Provider } from '../src/providers/types.js';
import type { PrFile } from '../src/types.js';
import { TWO_HUNK_PATCH, file } from './fixtures.js';

const config: Config = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  apiKey: 'k',
  baseUrl: undefined,
  effort: 'medium',
  githubToken: 't',
  include: ['**'],
  exclude: DEFAULT_EXCLUDE,
  maxFiles: 30,
  maxDiffBytes: 200_000,
  maxFileBytes: 50_000,
  maxOutputTokens: 16_000,
  minSeverity: 'low',
  skipDraft: true,
  dryRun: false,
  configPath: '.github/ai-review.yml',
  reviewerLogin: 'github-actions[bot]',
  suggestTests: false,
  maxTestSuggestions: 5,
};

const pr: PullRequestInfo = {
  number: 5,
  headSha: 'sha5',
  baseSha: 'base5',
  title: 'Change',
  body: '',
  draft: false,
};

function fakeGitHub(
  files: PrFile[],
  overrides: {
    getPullRequest?: Mock<GitHubApi['getPullRequest']>;
    createReview?: Mock<GitHubApi['createReview']>;
    repoConfig?: string;
    earlierBodies?: string[];
    /** Files at the repository root of the base commit, with their contents. */
    rootFiles?: Record<string, string>;
  } = {},
) {
  return {
    getPullRequest: overrides.getPullRequest ?? vi.fn<GitHubApi['getPullRequest']>().mockResolvedValue(pr),
    listFiles: vi.fn<GitHubApi['listFiles']>().mockResolvedValue(files),
    createReview:
      overrides.createReview ??
      vi.fn<GitHubApi['createReview']>().mockResolvedValue({ url: 'https://github.com/o/r/pull/5#review' }),
    getFileContent: vi
      .fn<GitHubApi['getFileContent']>()
      .mockImplementation((path) =>
        Promise.resolve(
          path === '.github/ai-review.yml' ? overrides.repoConfig : overrides.rootFiles?.[path],
        ),
      ),
    listDirectory: vi
      .fn<GitHubApi['listDirectory']>()
      .mockResolvedValue(Object.keys(overrides.rootFiles ?? {})),
    listBodiesBy: vi.fn<GitHubApi['listBodiesBy']>().mockResolvedValue(overrides.earlierBodies ?? []),
  };
}

function fakeProvider(...answers: unknown[]) {
  const complete = vi.fn<Provider['complete']>();
  for (const a of answers) {
    if (a instanceof Error) complete.mockRejectedValueOnce(a);
    else
      complete.mockResolvedValueOnce({
        json: a,
        model: 'claude-opus-5-5',
        usage: { inputTokens: 100, outputTokens: 10 },
      });
  }
  return { name: 'fake', complete };
}

const log = { info: vi.fn(), warning: vi.fn() };
const finding = (path: string, line: number, severity = 'high') => ({
  path,
  line,
  severity,
  title: `t${line}`,
  body: 'b',
});

function deps(github: GitHubApi, provider: Provider): EngineDeps {
  return { github, provider, log, nonce: 'n' };
}

describe('reviewPullRequest', () => {
  it('posts one review: on-diff findings inline, off-diff and invented-file findings handled', async () => {
    const github = fakeGitHub([
      file('src/list.ts', TWO_HUNK_PATCH),
      file('package-lock.json', '@@ -1 +1 @@\n-a\n+b'),
    ]);
    const provider = fakeProvider({
      findings: [finding('src/list.ts', 22), finding('src/list.ts', 40), finding('src/other.ts', 1)],
    });

    const outcome = await reviewPullRequest(deps(github, provider), config);

    expect(outcome).toMatchObject({ status: 'reviewed', inline: 1, offDiff: 1, failedChunks: 0 });
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(github.createReview).toHaveBeenCalledTimes(1);
    const review = github.createReview.mock.calls[0]?.[0];
    if (!review) throw new Error('no review posted');
    expect(review.comments).toEqual([
      expect.objectContaining({ path: 'src/list.ts', line: 22, side: 'RIGHT' }),
    ]);
    expect(review.body).toContain('`src/list.ts:40`');
    expect(review.body).not.toContain('src/other.ts'); // the model never saw that file
    expect(review.body).toContain('- `package-lock.json`: matched by exclude');
  });

  it('sends the schema and output cap to the provider', async () => {
    const provider = fakeProvider({ findings: [] });
    await reviewPullRequest(deps(fakeGitHub([file('a.ts', TWO_HUNK_PATCH)]), provider), config);
    expect(provider.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 16_000,
        schema: expect.objectContaining({ type: 'object' }) as unknown,
      }),
    );
  });

  it('does not post anything when there are no findings', async () => {
    const github = fakeGitHub([file('a.ts', TWO_HUNK_PATCH)]);
    const outcome = await reviewPullRequest(deps(github, fakeProvider({ findings: [] })), config);
    expect(outcome.status).toBe('clean');
    expect(github.createReview).not.toHaveBeenCalled();
  });

  it('skips without calling the model when nothing is reviewable', async () => {
    const provider = fakeProvider();
    const outcome = await reviewPullRequest(deps(fakeGitHub([file('yarn.lock', 'x')]), provider), config);
    expect(outcome).toMatchObject({ status: 'skipped' });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('re-checks draft state from the API', async () => {
    const github = fakeGitHub([], {
      getPullRequest: vi.fn<GitHubApi['getPullRequest']>().mockResolvedValue({ ...pr, draft: true }),
    });
    expect(await reviewPullRequest(deps(github, fakeProvider()), config)).toMatchObject({
      status: 'skipped',
    });
    expect(github.listFiles).not.toHaveBeenCalled();
  });

  it('keeps going when one chunk fails and says so in the summary', async () => {
    const big = (name: string) => file(name, '@@ -0,0 +1,1 @@\n+' + 'x'.repeat(40_000));
    const github = fakeGitHub([big('a.ts'), big('b.ts')]);
    const provider = fakeProvider(new ProviderError('refusal', 'declined'), {
      findings: [finding('b.ts', 1)],
    });
    const outcome = await reviewPullRequest(deps(github, provider), config);
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ status: 'reviewed', inline: 1, failedChunks: 1 });
    expect(github.createReview.mock.calls[0]?.[0].body).toContain('`a.ts`: refusal');
  });

  it('fails when every request fails, rather than posting an empty review', async () => {
    const github = fakeGitHub([file('a.ts', TWO_HUNK_PATCH)]);
    await expect(
      reviewPullRequest(deps(github, fakeProvider(new ProviderError('http', 'HTTP 500'))), config),
    ).rejects.toThrow(/All 1 review requests failed/);
    expect(github.createReview).not.toHaveBeenCalled();
  });

  it('does not swallow unexpected errors', async () => {
    const github = fakeGitHub([file('a.ts', TWO_HUNK_PATCH)]);
    await expect(reviewPullRequest(deps(github, fakeProvider(new TypeError('bug'))), config)).rejects.toThrow(
      'bug',
    );
  });

  it('logs the payload instead of posting in dry-run mode', async () => {
    const github = fakeGitHub([file('a.ts', TWO_HUNK_PATCH)]);
    const outcome = await reviewPullRequest(deps(github, fakeProvider({ findings: [finding('a.ts', 2)] })), {
      ...config,
      dryRun: true,
    });
    expect(outcome).toMatchObject({ status: 'dry-run', inline: 1 });
    expect(github.createReview).not.toHaveBeenCalled();
  });

  it('falls back to a summary-only review when GitHub rejects the anchors with 422', async () => {
    const createReview = vi
      .fn<GitHubApi['createReview']>()
      .mockRejectedValueOnce(Object.assign(new Error('Unprocessable'), { status: 422 }))
      .mockResolvedValueOnce({ url: 'u' });
    const github = fakeGitHub([file('a.ts', TWO_HUNK_PATCH)], { createReview });
    const outcome = await reviewPullRequest(
      deps(github, fakeProvider({ findings: [finding('a.ts', 2)] })),
      config,
    );
    expect(outcome).toMatchObject({ status: 'reviewed', inline: 0, offDiff: 1 });
    expect(createReview.mock.calls[1]?.[0]).toMatchObject({ comments: [] });
    expect(createReview.mock.calls[1]?.[0].body).toContain('`a.ts:2`');
  });

  it('sums token usage across chunks', async () => {
    const big = (name: string) => file(name, '@@ -0,0 +1,1 @@\n+' + 'x'.repeat(40_000));
    const provider = fakeProvider({ findings: [finding('a.ts', 1)] }, { findings: [] });
    const outcome = await reviewPullRequest(deps(fakeGitHub([big('a.ts'), big('b.ts')]), provider), config);
    expect(outcome).toMatchObject({ usage: { inputTokens: 200, outputTokens: 20 } });
  });
});

describe('repository config', () => {
  it('reads .github/ai-review.yml from the base commit and applies it', async () => {
    const github = fakeGitHub([file('src/a.ts', TWO_HUNK_PATCH), file('docs/x.md', TWO_HUNK_PATCH)], {
      repoConfig: 'rules: [Flag raw SQL]\nmin-severity: high\nexclude: ["docs/**"]\n',
    });
    const provider = fakeProvider({
      findings: [finding('src/a.ts', 2, 'medium'), finding('src/a.ts', 3, 'high')],
    });
    const outcome = await reviewPullRequest(deps(github, provider), config);

    expect(github.getFileContent).toHaveBeenCalledWith('.github/ai-review.yml', 'base5');
    expect(provider.complete.mock.calls[0]?.[0].user).toMatch(/Additional rules[\s\S]*- Flag raw SQL/);
    expect(provider.complete.mock.calls[0]?.[0].user).not.toContain('docs/x.md');
    expect(outcome).toMatchObject({ status: 'reviewed', inline: 1 }); // the medium finding is below the file's threshold
  });

  it('fails clearly on an invalid config file', async () => {
    const github = fakeGitHub([file('a.ts', TWO_HUNK_PATCH)], { repoConfig: 'min-severity: urgent' });
    await expect(reviewPullRequest(deps(github, fakeProvider()), config)).rejects.toThrow(/min-severity/);
  });
});

describe('de-duplication across runs', () => {
  it('marks posted findings and skips them on the next run', async () => {
    const files = [file('src/a.ts', TWO_HUNK_PATCH)];
    const answer = { findings: [finding('src/a.ts', 22), finding('src/a.ts', 99)] };

    const first = fakeGitHub(files);
    await reviewPullRequest(deps(first, fakeProvider(answer)), config);
    const posted = first.createReview.mock.calls[0]?.[0];
    if (!posted) throw new Error('no review posted');
    expect(posted.comments[0]?.body).toMatch(/ai-code-review-action:fp=[0-9a-f]{16}/);

    // Second run: the earlier inline comment and summary are visible; the model repeats itself.
    const second = fakeGitHub(files, { earlierBodies: [posted.body, ...posted.comments.map((c) => c.body)] });
    const outcome = await reviewPullRequest(deps(second, fakeProvider(answer)), config);
    expect(second.listBodiesBy).toHaveBeenCalledWith('github-actions[bot]');
    expect(outcome).toMatchObject({ status: 'clean', inline: 0, offDiff: 0 });
    expect(second.createReview).not.toHaveBeenCalled();
  });

  it('still reports a finding when the flagged line changed', async () => {
    const before = fakeGitHub([file('src/a.ts', TWO_HUNK_PATCH)]);
    await reviewPullRequest(deps(before, fakeProvider({ findings: [finding('src/a.ts', 22)] })), config);
    const earlier = before.createReview.mock.calls[0]?.[0].comments.map((c) => c.body) ?? [];

    const changedPatch = TWO_HUNK_PATCH.replace(
      'DELETE FROM t WHERE id = ${id}',
      'DELETE FROM t WHERE id = $1',
    );
    const after = fakeGitHub([file('src/a.ts', changedPatch)], { earlierBodies: earlier });
    const outcome = await reviewPullRequest(
      deps(after, fakeProvider({ findings: [finding('src/a.ts', 22)] })),
      config,
    );
    expect(outcome).toMatchObject({ status: 'reviewed', inline: 1 });
  });
});

describe('test suggestions', () => {
  const vitestRepo = { 'package.json': JSON.stringify({ devDependencies: { vitest: '5' } }) };
  const suggestion = {
    suggestions: [
      {
        target: 'src/a.ts',
        kind: 'unit',
        framework: 'vitest',
        testPath: 'test/a.test.ts',
        title: 'uses a parameterised delete',
        rationale: 'The delete query changed.',
        code: "import { it } from 'vitest';",
      },
    ],
  };

  it('is off by default: no framework detection, no extra request', async () => {
    const github = fakeGitHub([file('src/a.ts', TWO_HUNK_PATCH)], { rootFiles: vitestRepo });
    const provider = fakeProvider({ findings: [] });
    await reviewPullRequest(deps(github, provider), config);
    expect(provider.complete).toHaveBeenCalledTimes(1);
    expect(github.listDirectory).not.toHaveBeenCalled();
  });

  it('posts a review with only suggestions when there are no findings, and counts their tokens', async () => {
    const github = fakeGitHub([file('src/a.ts', TWO_HUNK_PATCH)], { rootFiles: vitestRepo });
    const provider = fakeProvider({ findings: [] }, suggestion);
    const outcome = await reviewPullRequest(deps(github, provider), { ...config, suggestTests: true });

    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({
      status: 'reviewed',
      inline: 0,
      testSuggestions: 1,
      usage: { inputTokens: 200, outputTokens: 20 },
    });
    const review = github.createReview.mock.calls[0]?.[0];
    expect(review?.comments).toEqual([]);
    expect(review?.body).toContain('### Suggested tests');
    expect(review?.body).toContain('uses a parameterised delete');
  });

  it('stays clean when the suggestion request returns nothing', async () => {
    const github = fakeGitHub([file('src/a.ts', TWO_HUNK_PATCH)], { rootFiles: vitestRepo });
    const provider = fakeProvider({ findings: [] }, { suggestions: [] });
    const outcome = await reviewPullRequest(deps(github, provider), { ...config, suggestTests: true });
    expect(outcome).toMatchObject({ status: 'clean', testSuggestions: 0 });
    expect(github.createReview).not.toHaveBeenCalled();
  });

  it('keeps the review when the suggestion request fails', async () => {
    const github = fakeGitHub([file('src/a.ts', TWO_HUNK_PATCH)], { rootFiles: vitestRepo });
    const provider = fakeProvider({ findings: [finding('src/a.ts', 2)] }, new ProviderError('refusal', 'no'));
    const outcome = await reviewPullRequest(deps(github, provider), { ...config, suggestTests: true });
    expect(outcome).toMatchObject({ status: 'reviewed', inline: 1, testSuggestions: 0 });
    expect(github.createReview.mock.calls[0]?.[0].body).toContain('Test suggestions unavailable: refusal.');
  });

  it('keeps suggestions in the 422 summary-only fallback', async () => {
    const createReview = vi
      .fn<GitHubApi['createReview']>()
      .mockRejectedValueOnce(Object.assign(new Error('Unprocessable'), { status: 422 }))
      .mockResolvedValueOnce({ url: 'u' });
    const github = fakeGitHub([file('src/a.ts', TWO_HUNK_PATCH)], { rootFiles: vitestRepo, createReview });
    const provider = fakeProvider({ findings: [finding('src/a.ts', 2)] }, suggestion);
    await reviewPullRequest(deps(github, provider), { ...config, suggestTests: true });
    expect(createReview.mock.calls[1]?.[0].body).toContain('### Suggested tests');
  });
});
