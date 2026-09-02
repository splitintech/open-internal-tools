import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { VerificationLauncher } from '../src/launcher/VerificationLauncher.tsx';
import type { VerificationStatusEnvelope } from '@splitin/verification-web';

function envelope(): VerificationStatusEnvelope {
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
      transientSecret: 'mem_secret',
    },
    launcherKey: 'test_embedded',
    providerDisclosure: 'Test provider',
    safeErrorCode: null,
    retryAfter: null,
    supportPath: '/support/verification',
    expiresAt: null,
    canResume: true,
    canRetry: false,
    continuation: { key: 'verification.resume', token: 'tok_1', expiresAt: '2099-01-01T00:00:00.000Z' },
  };
}

function mockMatchMedia(matchesFor: (query: string) => boolean) {
  window.matchMedia = ((query: string) => ({
    matches: matchesFor(query),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function renderLauncher() {
  return render(
    <VerificationLauncher
      open
      session={envelope()}
      onOpenChange={() => undefined}
      onSessionChange={() => undefined}
      onStatusRefresh={async () => false}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe('desktop, mobile web, and installed PWA matrix', () => {
  it('marks a wide viewport as the desktop surface', () => {
    mockMatchMedia(() => false);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    renderLauncher();
    expect(screen.getByTestId('verification-launcher')).toHaveAttribute('data-surface', 'desktop');
  });

  it('marks a narrow viewport as mobile web', () => {
    mockMatchMedia((query) => query.includes('max-width: 640px'));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderLauncher();
    expect(screen.getByTestId('verification-launcher')).toHaveAttribute('data-surface', 'mobile-web');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('marks display-mode standalone as installed PWA and shows installed-app camera copy', () => {
    mockMatchMedia((query) => query.includes('display-mode: standalone'));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    renderLauncher();
    expect(screen.getByTestId('verification-launcher')).toHaveAttribute('data-surface', 'installed-pwa');
    expect(screen.getByText(/This app is installed/i)).toBeInTheDocument();
  });
});
