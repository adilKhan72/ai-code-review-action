import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/** Release guards: the public surface in action.yml must match what the code reads and the README documents. */

interface ActionMetadata {
  name: string;
  description: string;
  branding?: { icon?: string; color?: string };
  inputs: Record<string, { description?: string; default?: string; required?: boolean }>;
  outputs: Record<string, { description?: string }>;
  runs: { using: string; main: string };
}

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const action = parse(read('action.yml')) as ActionMetadata;
const readme = read('README.md');
const sources = ['src/config.ts', 'src/index.ts'].map(read).join('\n');

describe('action.yml', () => {
  it('has what the GitHub Marketplace requires', () => {
    expect(action.name.length).toBeGreaterThan(0);
    expect(action.description.length).toBeLessThanOrEqual(125);
    expect(action.branding?.icon).toBeTruthy();
    expect(action.branding?.color).toBeTruthy();
  });

  it('runs the committed bundle on a current Node runtime', () => {
    expect(action.runs).toEqual({ using: 'node24', main: 'dist/index.cjs' });
  });

  it.each(Object.keys(action.inputs))(
    'input "%s" has a description and a default, is read and documented',
    (name) => {
      const input = action.inputs[name];
      expect(input?.description).toBeTruthy();
      expect(input?.default).toBeDefined();
      expect(sources).toContain(`input('${name}')`);
      expect(readme).toContain(`| \`${name}\``);
    },
  );

  it.each(Object.keys(action.outputs))('output "%s" is set and documented', (name) => {
    expect(action.outputs[name]?.description).toBeTruthy();
    expect(sources).toContain(`setOutput('${name}'`);
    expect(readme).toContain(`\`${name}\``);
  });
});

describe('release metadata', () => {
  const pkg = JSON.parse(read('package.json')) as { version: string };

  it('has a changelog entry for the package version', () => {
    expect(read('CHANGELOG.md')).toContain(`## [${pkg.version}] - `);
  });

  it('documents a usage example pinned to the current major version', () => {
    const major = pkg.version.split('.')[0] ?? '';
    expect(readme).toContain(`uses: adilKhan72/ai-code-review-action@v${major}`);
  });
});
