/**
 * Talks to the Home Assistant the repository's docker-compose already provides.
 *
 * The suite deliberately reuses that instance instead of booting one of its
 * own. A fresh clone (and CI) starts with an empty `test_config/`, so global
 * setup onboards the instance through Home Assistant's own onboarding API when
 * it is not onboarded yet, and the demo resort is added through the config flow
 * (demo mode needs no SnowSure API key). Everything the suite writes goes into
 * a dashboard of its own, so a manual playground stays intact.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const E2E_DIR = resolve(here, '..');
const REPO_ROOT = resolve(E2E_DIR, '../..');
const TOKEN_FILE = resolve(E2E_DIR, '.auth.json');

/** Read from the compose file so the suite cannot drift from the environment. */
function portFromCompose(): string {
  const compose = readFileSync(resolve(REPO_ROOT, 'docker-compose.yml'), 'utf8');
  const match = compose.match(/'(\d+):8123'/) ?? compose.match(/"(\d+):8123"/);
  if (!match) throw new Error('No published Home Assistant port found in docker-compose.yml');
  return match[1];
}

export const PORT = process.env.HA_E2E_PORT ?? portFromCompose();
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const USERNAME = process.env.HA_E2E_USER ?? 'admin';
export const PASSWORD = process.env.HA_E2E_PASSWORD ?? 'password';

const CONTAINER_NAME = 'ha-snowsure-test';

/**
 * Brings the repository's own compose environment up if it is not running.
 *
 * - `HA_E2E_MANAGE_DOCKER=0` skips compose entirely: the suite then only talks
 *   to whatever answers on the port (a running instance, or one you started).
 * - An existing container that was created from another checkout (another
 *   compose working directory, e.g. a git worktree) is never recreated: that
 *   would swap the developer instance's mounts for this copy's. The suite
 *   stops with a message instead.
 */
export function ensureRunning(): void {
  if (process.env.HA_E2E_MANAGE_DOCKER === '0') return;

  const owner = composeWorkingDir(CONTAINER_NAME);
  if (owner !== undefined && resolve(owner) !== REPO_ROOT) {
    throw new Error(
      `Container ${CONTAINER_NAME} belongs to the checkout ${owner}, not ${REPO_ROOT}. ` +
        'Run the suite from that checkout, or set HA_E2E_MANAGE_DOCKER=0 to use the running instance as it is.',
    );
  }
  execFileSync('docker', ['compose', 'up', '-d'], { cwd: REPO_ROOT, stdio: 'inherit' });
}

/** The compose working directory a container was created from, if the container exists. */
export function composeWorkingDir(container: string): string | undefined {
  try {
    const out = execFileSync(
      'docker',
      ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project.working_dir"}}', container],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return out || undefined;
  } catch {
    // No such container (fresh clone, CI) or docker not reachable: compose decides.
    return undefined;
  }
}

export async function waitForFrontend(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      // Not /api/onboarding: that endpoint is gone once onboarding is done.
      const res = await fetch(`${BASE_URL}/manifest.json`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Home Assistant did not answer at ${BASE_URL} within ${timeoutMs}ms`);
}

/**
 * Onboards a fresh Home Assistant (creates the admin user and finishes the
 * remaining onboarding steps) and does nothing on one that is onboarded already.
 * `/api/onboarding` answers 404 once onboarding is complete.
 */
export async function onboardIfNeeded(): Promise<void> {
  const status = await fetch(`${BASE_URL}/api/onboarding`);
  if (!status.ok) return;
  const steps = (await status.json()) as { step: string; done: boolean }[];
  if (steps.every((step) => step.done)) return;

  const clientId = `${BASE_URL}/`;
  const json = { 'Content-Type': 'application/json' };

  let token: string | undefined;
  if (!steps.find((step) => step.step === 'user')?.done) {
    const created = await fetch(`${BASE_URL}/api/onboarding/users`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        client_id: clientId,
        name: 'E2E Admin',
        username: USERNAME,
        password: PASSWORD,
        language: 'en',
      }),
    });
    if (!created.ok) throw new Error(`onboarding user step failed: ${created.status} ${await created.text()}`);
    const { auth_code } = (await created.json()) as { auth_code: string };
    const exchanged = await fetch(`${BASE_URL}/auth/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'authorization_code', code: auth_code, client_id: clientId }),
    });
    if (!exchanged.ok) throw new Error(`token exchange failed: ${exchanged.status} ${await exchanged.text()}`);
    token = ((await exchanged.json()) as { access_token: string }).access_token;
  }

  if (token) {
    // The remaining steps need the new user's token; each is a no-op body.
    for (const [step, body] of [
      ['core_config', {}],
      ['analytics', {}],
      ['integration', { client_id: clientId, redirect_uri: `${clientId}?auth_callback=1` }],
    ] as const) {
      const res = await fetch(`${BASE_URL}/api/onboarding/${step}`, {
        method: 'POST',
        headers: { ...json, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`onboarding ${step} step failed: ${res.status} ${await res.text()}`);
    }
  }
}

export interface Tokens {
  access_token: string;
}

export function saveTokens(tokens: Tokens): void {
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

export function readTokens(): Tokens {
  if (!existsSync(TOKEN_FILE)) throw new Error('No token file - did global setup run?');
  return JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) as Tokens;
}

/**
 * Sends one command over the websocket API and returns its result. Node ships a
 * WebSocket client, so this needs no dependency, and it is the same API the
 * frontend itself speaks.
 */
export async function callWebsocket<T = unknown>(message: Record<string, unknown>): Promise<T> {
  const token = readTokens().access_token;
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/api/websocket`);

  return new Promise<T>((resolve_, reject) => {
    const fail = (reason: string) => {
      socket.close();
      reject(new Error(reason));
    };
    const timer = setTimeout(() => fail('websocket timed out'), 30_000);

    socket.addEventListener('error', () => fail('websocket error'));
    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(String(event.data)) as Record<string, unknown>;
      switch (payload.type) {
        case 'auth_required':
          socket.send(JSON.stringify({ type: 'auth', access_token: token }));
          return;
        case 'auth_invalid':
          clearTimeout(timer);
          fail('websocket authentication was refused');
          return;
        case 'auth_ok':
          socket.send(JSON.stringify({ id: 1, ...message }));
          return;
        case 'result': {
          clearTimeout(timer);
          socket.close();
          if (payload.success) resolve_(payload.result as T);
          else reject(new Error(`websocket command failed: ${JSON.stringify(payload.error)}`));
        }
      }
    });
  });
}

/** Puts a state on the bus, the way any client would. */
export async function setState(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/states/${entityId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${readTokens().access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, attributes }),
  });
  if (!res.ok) throw new Error(`setting ${entityId} failed: ${res.status} ${await res.text()}`);
}

export async function removeState(entityId: string): Promise<void> {
  await fetch(`${BASE_URL}/api/states/${entityId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${readTokens().access_token}` },
  });
}

/**
 * Gives the caller its own dashboard.
 *
 * Every spec file asks for a different name, so specs can run in parallel
 * without fighting over one dashboard - and none of them touches whatever the
 * manual test instance has on its own dashboards.
 */
export async function useDashboard(name: string, config: Record<string, unknown>): Promise<string> {
  const urlPath = `e2e-${name}`;
  const dashboards = await callWebsocket<{ url_path: string }[]>({
    type: 'lovelace/dashboards/list',
  });
  if (!dashboards.some((dashboard) => dashboard.url_path === urlPath)) {
    await callWebsocket({
      type: 'lovelace/dashboards/create',
      url_path: urlPath,
      title: `E2E ${name}`,
      mode: 'storage',
      show_in_sidebar: false,
    });
  }
  await callWebsocket({ type: 'lovelace/config/save', url_path: urlPath, config });
  return urlPath;
}

/**
 * Waits until the core has finished starting.
 *
 * `/manifest.json` answers well before that, and the card resource is
 * registered from an EVENT_HOMEASSISTANT_STARTED listener - so a suite that
 * only waited for HTTP would read the resource store mid-startup and see
 * whatever was left there by the previous run.
 */
export async function waitForCoreRunning(timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const config = await callWebsocket<{ state: string }>({ type: 'get_config' }).catch(() => undefined);
    if (config?.state === 'RUNNING') return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Home Assistant did not reach state RUNNING within ${timeoutMs}ms`);
}

/** The Lovelace resources Home Assistant has persisted. */
export async function resources(): Promise<{ id: string; url: string }[]> {
  return callWebsocket({ type: 'lovelace/resources' });
}

export const DEMO_NAME = 'Kaiserberg (Demo)';
const DEMO_UNIQUE_ID = 'kaiserberg-demo';
/** Remembers that this suite re-enabled the demo entry, across worker processes. */
const DEMO_MARKER_FILE = resolve(E2E_DIR, '.demo-entry-disabled.json');

interface ConfigEntry {
  entry_id: string;
  unique_id: string | null;
  state: string;
  disabled_by: string | null;
}

const demoEntry = async () =>
  (await callWebsocket<ConfigEntry[]>({ type: 'config_entries/get', domain: 'snowsure' })).find(
    (entry) => entry.unique_id === DEMO_UNIQUE_ID,
  );

/**
 * A disabled demo entry keeps its device in the registry but loads no
 * entities, so every card test would sit in its timeout. Re-enable it (and
 * remember that, so {@link restoreDemoEntry} can put it back) or fail with a
 * message that says what is wrong. No entry at all is fine: demoDevice()
 * creates it.
 */
export async function ensureDemoEntryEnabled(): Promise<void> {
  const entry = await demoEntry();
  if (!entry || !entry.disabled_by) return;
  if (entry.disabled_by !== 'user') {
    throw new Error(
      `The demo config entry is disabled by "${entry.disabled_by}" and cannot be re-enabled by the suite.`,
    );
  }
  writeFileSync(DEMO_MARKER_FILE, JSON.stringify({ entry_id: entry.entry_id }));
  await callWebsocket({ type: 'config_entries/disable', entry_id: entry.entry_id, disabled_by: null });

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if ((await demoEntry())?.state === 'loaded') return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The demo config entry was re-enabled but did not reach state "loaded" in time.');
}

/** Disables the demo entry again if {@link ensureDemoEntryEnabled} had to enable it. */
export async function restoreDemoEntry(): Promise<void> {
  if (!existsSync(DEMO_MARKER_FILE)) return;
  const { entry_id } = JSON.parse(readFileSync(DEMO_MARKER_FILE, 'utf8')) as { entry_id: string };
  await callWebsocket({ type: 'config_entries/disable', entry_id, disabled_by: 'user' });
  rmSync(DEMO_MARKER_FILE);
}

/**
 * The device id of the made-up demo resort (custom_components/snowsure/demo.py),
 * set up through the config flow if this instance does not have it yet. The
 * container runs with SNOWSURE_DEMO=1, so its dates always follow today:
 * powder today, Kaiserwetter tomorrow, avalanche level 4.
 */
export async function demoDevice(): Promise<string> {
  await ensureDemoEntryEnabled();
  const find = async () =>
    (await callWebsocket<{ id: string; name: string }[]>({ type: 'config/device_registry/list' })).find(
      (device) => device.name === DEMO_NAME,
    )?.id;
  const existing = await find();
  if (existing) return existing;

  const post = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${BASE_URL}/api/config/config_entries/flow${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${readTokens().access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`config flow ${path} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as { flow_id: string; type: string };
  };
  const flow = await post('', { handler: 'snowsure' });
  await post(`/${flow.flow_id}`, {});
  await post(`/${flow.flow_id}`, { country: 'Demo' });
  await post(`/${flow.flow_id}`, { resort: 'kaiserberg-demo' });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const id = await find();
    if (id) return id;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('The demo resort did not appear - is SNOWSURE_DEMO=1 set in docker-compose.yml?');
}
