# Release checklist

Releases are cut from `main` after the release PR is merged. The action runs from the committed bundle
`dist/index.cjs`, so a tag is the whole release. There is no package to publish.

## Versioning

- **Patch** (`1.0.x`): bug fixes, no input, output or review-format change.
- **Minor** (`1.x.0`): new inputs or outputs with defaults that keep the old behaviour. New opt-in features.
- **Major** (`x.0.0`): removed or renamed inputs or outputs, changed defaults, a new minimum runner version
  (`runs.using`), or anything that makes existing workflows behave differently.
- `v1` is a **moving** tag that always points at the latest `1.x.y`. `v1.2.3` tags never move.

## Before the release PR

1. `main` is green, including the `self-test` job.
2. `CHANGELOG.md`: move items from `[Unreleased]` into a new `[x.y.z] - YYYY-MM-DD` section and update the
   compare links at the bottom.
3. Bump `version` in `package.json` (and run `npm install --package-lock-only` so the lockfile matches).
4. README: the usage examples use `@v1`. For a major release, update them to the new major.
5. `npm run all` locally. CI fails if `dist/` is stale, but run `npm run build` and commit `dist/` anyway.
6. `action.yml`: every input has a description and a default, and `branding` is set (Marketplace needs it).
   `test/action-metadata.test.ts` checks that every input is documented in the README and read by the code.

## Cut the release

After the release PR is squash-merged, with `SHA` = the merge commit on `main`:

```bash
git switch main && git pull
SHA=$(git rev-parse HEAD)

# Immutable version tag.
git tag -a v1.2.3 -m "v1.2.3" "$SHA" && git push origin v1.2.3

# Move the major tag. Force is expected here, and only here.
git tag -fa v1 -m "v1 -> v1.2.3" "$SHA" && git push -f origin v1
```

Or through the REST API, for lightweight tags:

```bash
POST  /repos/{owner}/{repo}/git/refs          {"ref":"refs/tags/v1.2.3","sha":"<SHA>"}
PATCH /repos/{owner}/{repo}/git/refs/tags/v1   {"sha":"<SHA>","force":true}   # POST refs/tags/v1 the first time
```

Then create the GitHub release for `v1.2.3`. Use the changelog section as notes, and include the full commit SHA
for people who pin by SHA. Mark it as latest.

## After the release

1. Check that `uses: adilKhan72/ai-code-review-action@v1` resolves to the new SHA:
   `git ls-remote --tags origin v1 v1.2.3`. Lightweight tags show the commit directly; annotated tags have
   a `^{}` line with the commit.
2. If the README pins an example to a full SHA, update it in a follow-up PR. A commit cannot contain its own SHA.
3. **Marketplace** (first time only, manual): Releases → edit the release → tick _Publish this Action to the
   GitHub Marketplace_. This needs the account owner to accept the Marketplace Developer Agreement once, and
   the action `name` in `action.yml` must be unique on the Marketplace. Choose the primary and secondary
   categories in the same form. Later releases are offered for publishing on the same release form.

## Rolling back

Point `v1` back at the previous good release's SHA (the same `PATCH` / force-push as above) and publish a patch
release with the fix. Never delete or move a `vX.Y.Z` tag. People pin to them.
