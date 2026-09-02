import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';

import { VerificationLauncher } from '../src/launcher/VerificationLauncher.tsx';
import { VerificationStatus } from '../src/status/VerificationStatus.tsx';
import { AppealForm } from '../src/appeal/AppealForm.tsx';
import type { VerificationStatusEnvelope } from '@splitin/verification-web';
import type { ProviderLauncherProps } from '../src/plugins/stripe.tsx';

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
    ...overrides,
  };
}

function FakePlugin({ onCallback }: ProviderLauncherProps) {
  return <button type="button" onClick={onCallback}>Complete provider</button>;
}

function CameraDeniedPlugin({ onError }: ProviderLauncherProps) {
  useEffect(() => {
    onError('Camera permission was denied.');
  }, [onError]);
  return <p>Provider waiting on camera</p>;
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VerificationLauncher', () => {
  it('exposes dialog and live status roles', () => {
    render(
      <VerificationLauncher
        open
        session={envelope()}
        onOpenChange={() => undefined}
        onSessionChange={() => undefined}
        onStatusRefresh={async () => false}
        plugins={{ test_embedded: FakePlugin }}
      />,
    );
    expect(screen.getByRole('dialog', { name: /secure identity verification/i })).toBeInTheDocument();
    expect(screen.getByTestId('verification-provider-disclosure')).toHaveTextContent('Test provider');
  });

  it('treats browser onComplete as refreshStatus only', async () => {
    const refresh = vi.fn(async () => false);
    const onSessionChange = vi.fn();
    render(
      <VerificationLauncher
        open
        session={envelope()}
        onOpenChange={() => undefined}
        onSessionChange={onSessionChange}
        onStatusRefresh={refresh}
        plugins={{ test_embedded: FakePlugin }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Complete provider' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(onSessionChange).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'verified' }));
  });

  it('does not auto-open plugins when reduced motion is preferred', () => {
    mockMatchMedia((query) => query.includes('prefers-reduced-motion: reduce'));
    render(
      <VerificationLauncher
        open
        session={envelope()}
        onOpenChange={() => undefined}
        onSessionChange={() => undefined}
        onStatusRefresh={async () => false}
        plugins={{ test_embedded: FakePlugin }}
      />,
    );
    expect(screen.getByTestId('verification-launcher')).toHaveAttribute('data-reduced-motion', 'true');
    expect(screen.queryByRole('button', { name: 'Complete provider' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start verification' }));
    expect(screen.getByRole('button', { name: 'Complete provider' })).toBeInTheDocument();
  });

  it('shows camera help after a camera-denied plugin error', async () => {
    render(
      <VerificationLauncher
        open
        session={envelope()}
        onOpenChange={() => undefined}
        onSessionChange={() => undefined}
        onStatusRefresh={async () => false}
        plugins={{ test_embedded: CameraDeniedPlugin }}
      />,
    );
    expect(await screen.findByTestId('verification-camera-help')).toBeInTheDocument();
    expect(screen.getByText(/Continue on another device/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Continue on another device')).toHaveAttribute('data-emphasis', 'true');
  });

  it('shows installed PWA camera copy when display-mode is standalone', () => {
    mockMatchMedia((query) => query.includes('display-mode: standalone'));
    render(
      <VerificationLauncher
        open
        session={envelope()}
        onOpenChange={() => undefined}
        onSessionChange={() => undefined}
        onStatusRefresh={async () => false}
        plugins={{ test_embedded: FakePlugin }}
      />,
    );
    expect(screen.getByText(/This app is installed/i)).toBeInTheDocument();
  });
});

describe('VerificationStatus', () => {
  it('announces status with a live region', () => {
    render(<VerificationStatus envelope={envelope({ status: 'processing' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/processing/i);
  });
});

describe('AppealForm', () => {
  it('submits a review request', async () => {
    const onSubmit = vi.fn(async () => ({ appealId: 'apl_12345678', status: 'open' }));
    render(<AppealForm attemptId="att_1" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit review request' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(await screen.findByRole('status')).toHaveTextContent(/apl_1234/i);
  });
});
