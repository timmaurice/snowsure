import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

import { execFileSync } from 'node:child_process';
import { ensureRunning } from '../e2e/helpers/homeassistant';

const exec = vi.mocked(execFileSync);
const repoRoot = process.cwd();
const composeCalls = () => exec.mock.calls.filter(([, args]) => (args as string[])[0] === 'compose');

beforeEach(() => {
  exec.mockReset();
  delete process.env.HA_E2E_MANAGE_DOCKER;
});
afterEach(() => {
  delete process.env.HA_E2E_MANAGE_DOCKER;
});

describe('ensureRunning', () => {
  it('does not touch docker when HA_E2E_MANAGE_DOCKER=0', () => {
    process.env.HA_E2E_MANAGE_DOCKER = '0';
    ensureRunning();
    expect(exec).not.toHaveBeenCalled();
  });

  it('starts compose when there is no container yet (CI, fresh clone)', () => {
    exec.mockImplementation((_cmd, args) => {
      if ((args as string[])[0] === 'inspect') throw new Error('No such object');
      return Buffer.from('');
    });
    ensureRunning();
    expect(composeCalls()).toHaveLength(1);
  });

  it('starts compose when the container belongs to this checkout', () => {
    exec.mockImplementation((_cmd, args) => ((args as string[])[0] === 'inspect' ? repoRoot : Buffer.from('')));
    ensureRunning();
    expect(composeCalls()).toHaveLength(1);
  });

  it('refuses to recreate a container created from another checkout', () => {
    exec.mockImplementation((_cmd, args) =>
      (args as string[])[0] === 'inspect' ? '/somewhere/else/snowsure' : Buffer.from(''),
    );
    expect(() => ensureRunning()).toThrow(/HA_E2E_MANAGE_DOCKER=0/);
    expect(composeCalls()).toHaveLength(0);
  });
});
