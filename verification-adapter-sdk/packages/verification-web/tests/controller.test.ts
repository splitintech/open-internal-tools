import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVerificationWebController } from '../src/controller.ts';
import { forgetAllTransientSecrets, peekTransientSecret, rememberTransientSecret } from '../src/secrets.ts';
import { clearPluginCache } from '../src/plugins.ts';
import type { BrowserPlugin, VerificationStatusEnvelope } from '../src/types.ts';

function envelope(overrides: Partial<VerificationStatusEnvelope> = {}): VerificationStatusEnvelope {
  return {
    contractVersion: '1.0.0',
    attemptId: 'att_1',
    packageCode: 'human_idv',
    status: 'pending_user_input',
    presentation: 'embedded',
    launch: {
      attemptId: 'att_1',
      canonicalStatus: 'pending_user_input',
      launcherKey: 'test_embedded',
      presentation: 'embedded',
      providerDisclosure: 'Test provider',
      transientSecret: 'mem_secret_1',
      transientSecretExpiresAt: '2099-01-01T00:00:00.000Z',
    },
    launcherKey: 'test_embedded',
    providerDisclosure: 'Test provider',
    safeErrorCode: null,
    retryAfter: null,
    supportPath: '/support/verification',
    expiresAt: '2099-01-01T01:00:00.000Z',
    canResume: true,
    canRetry: false,
    continuation: { key: 'verification.resume', token: 'tok_1', expiresAt: '2099-01-01T00:15:00.000Z' },
    ...overrides,
  };
}

afterEach(() => {
  forgetAllTransientSecrets();
  clearPluginCache();
});

describe('transient secrets', () => {
  it('keeps secrets in module memory and never writes Web Storage', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    rememberTransientSecret('att_1', 'mem_secret_1', '2099-01-01T00:00:00.000Z');
    expect(peekTransientSecret('att_1')).toBe('mem_secret_1');
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('createVerificationWebController', () => {
  it('loads a plugin by launcherKey and treats completion as a status refresh only', async () => {
    let completed = false;
    const plugin: BrowserPlugin = {
      launcherKey: 'test_embedded',
      async present(input) {
        completed = true;
        input.onComplete();
        return { destroy() { /* noop */ } };
      },
    };
    const refreshStatus = vi.fn(async () => envelope({ status: 'processing', launch: null }));
    const controller = createVerificationWebController({
      plugins: { test_embedded: plugin },
      refreshStatus,
    });
    const container = document.createElement('div');
    const session = await controller.present({ envelope: envelope(), container });
    expect(completed).toBe(true);
    expect(refreshStatus).toHaveBeenCalledWith('att_1');
    expect(refreshStatus).toHaveBeenCalledTimes(1);
    session.destroy();
  });

  it('does not invent a verified decision in the browser', async () => {
    const plugin: BrowserPlugin = {
      launcherKey: 'test_embedded',
      async present(input) {
        input.onComplete();
        return { destroy() { /* noop */ } };
      },
    };
    const refreshStatus = vi.fn(async () => envelope({ status: 'processing' }));
    let latest: VerificationStatusEnvelope | undefined;
    const controller = createVerificationWebController({ plugins: { test_embedded: plugin }, refreshStatus });
    await controller.present({
      envelope: envelope(),
      container: document.createElement('div'),
      onEnvelopeChange: (next) => { latest = next; },
    });
    expect(latest?.status).toBe('processing');
    expect(latest?.status).not.toBe('verified');
  });

  it('presents hosted fallback without a plugin', async () => {
    const controller = createVerificationWebController({
      plugins: {},
      refreshStatus: async () => envelope(),
    });
    const container = document.createElement('div');
    await controller.present({
      envelope: envelope({
        presentation: 'hosted',
        launch: {
          attemptId: 'att_1',
          canonicalStatus: 'pending_user_input',
          launcherKey: 'hosted',
          presentation: 'hosted',
          hostedUrl: 'https://verify.example.test/session',
        },
      }),
      container,
    });
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://verify.example.test/session');
  });

  it('calls options.resume then re-presents the plugin', async () => {
    let presents = 0;
    const plugin: BrowserPlugin = {
      launcherKey: 'test_embedded',
      async present() {
        presents += 1;
        return { destroy() { /* noop */ } };
      },
    };
    const resume = vi.fn(async () => envelope({ status: 'pending_user_input' }));
    const controller = createVerificationWebController({
      plugins: { test_embedded: plugin },
      refreshStatus: async () => envelope(),
      resume,
    });
    const session = await controller.present({ envelope: envelope(), container: document.createElement('div') });
    expect(presents).toBe(1);
    await session.resume();
    expect(resume).toHaveBeenCalledWith('att_1');
    expect(presents).toBe(2);
    session.destroy();
  });
});
