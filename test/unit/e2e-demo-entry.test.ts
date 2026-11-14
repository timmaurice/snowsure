import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Playwright helpers are unit-tested here with a fake websocket; no
// Home Assistant, Docker or browser is involved.
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    existsSync: vi.fn(() => true),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    readFileSync: vi.fn((path: string, enc?: BufferEncoding) =>
      String(path).endsWith('.auth.json') ? '{"access_token":"t"}' : real.readFileSync(path, enc),
    ),
  };
});

import { writeFileSync } from 'node:fs';
import { ensureDemoEntryEnabled, isDemoEntry } from '../e2e/helpers/homeassistant';

type Entry = Record<string, unknown>;
let entries: Entry[];
let sent: Record<string, unknown>[];

class FakeSocket {
  private listeners: Record<string, ((e: { data?: string }) => void)[]> = {};
  constructor() {
    setTimeout(() => this.emit('message', { type: 'auth_required' }));
  }
  addEventListener(type: string, fn: (e: { data?: string }) => void) {
    (this.listeners[type] ??= []).push(fn);
  }
  private emit(type: string, payload: Record<string, unknown>) {
    for (const fn of this.listeners[type] ?? []) fn({ data: JSON.stringify(payload) });
  }
  send(raw: string) {
    const msg = JSON.parse(raw) as Record<string, unknown>;
    if (msg.type === 'auth') return this.emit('message', { type: 'auth_ok' });
    sent.push(msg);
    if (msg.type === 'config_entries/disable') {
      const entry = entries.find((e) => e.entry_id === msg.entry_id)!;
      entry.disabled_by = msg.disabled_by;
      entry.state = msg.disabled_by ? 'user_disabled' : 'loaded';
    }
    this.emit('message', { type: 'result', success: true, result: msg.type === 'config_entries/get' ? entries : null });
  }
  close() {}
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => vi.unstubAllGlobals());

// config_entries/get in HA 2026.11.1: no unique_id.
const demo = (extra: Entry = {}): Entry => ({
  entry_id: 'e1',
  domain: 'snowsure',
  title: 'Kaiserberg (Demo)',
  state: 'loaded',
  disabled_by: null,
  ...extra,
});

describe('demo config entry lookup', () => {
  it('matches by title without a unique_id', () => {
    expect(isDemoEntry(demo() as never)).toBe(true);
    expect(isDemoEntry(demo({ title: 'Other resort' }) as never)).toBe(false);
  });

  it('still matches by unique_id on releases that report it', () => {
    expect(isDemoEntry(demo({ title: 'x', unique_id: 'kaiserberg-demo' }) as never)).toBe(true);
  });

  it('re-enables a user-disabled demo entry that has no unique_id', async () => {
    entries = [demo({ disabled_by: 'user', state: 'user_disabled' })];
    await ensureDemoEntryEnabled();
    expect(sent.some((m) => m.type === 'config_entries/disable' && m.entry_id === 'e1' && m.disabled_by === null)).toBe(
      true,
    );
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('leaves an enabled demo entry alone', async () => {
    entries = [demo()];
    await ensureDemoEntryEnabled();
    expect(sent.some((m) => m.type === 'config_entries/disable')).toBe(false);
  });
});
