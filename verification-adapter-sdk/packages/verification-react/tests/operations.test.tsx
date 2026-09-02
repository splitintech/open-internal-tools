import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OperationsConsole } from '../src/operations/OperationsConsole.tsx';

afterEach(() => cleanup());

describe('OperationsConsole', () => {
  it('always sends CSRF and idempotency headers on mutations', async () => {
    const mutate = vi.fn<(path: string, body: unknown, headers: Record<string, string>) => Promise<unknown>>(async () => ({}));
    const get = vi.fn(async (path: string) => {
      if (path.endsWith('/routes')) {
        return { generatedAt: '2026-01-01T00:00:00.000Z', routes: [], routeChanges: [{ id: 'chg_1', status: 'proposed', proposedBy: 'ops_1', action: 'drain' }] };
      }
      return { generatedAt: '2026-01-01T00:00:00.000Z', runtime: [], health: [], alerts: [], circuits: [], attempts: [], appeals: [], manualExceptions: [], audit: [], jobs: [], privacyRequests: [], queues: {} };
    });
    render(
      <OperationsConsole
        client={{
          get,
          mutate,
          getCsrfToken: () => 'csrf-token',
          createIdempotencyKey: () => 'idem-fixed',
          currentActorId: 'ops_1',
        }}
      />,
    );
    await waitFor(() => expect(get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('tab', { name: 'routes' }));
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const call = mutate.mock.calls[0];
    expect(call).toBeTruthy();
    const headers = (call?.[2] ?? {}) as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('idem-fixed');
    expect(headers['X-CSRF-Token']).toBe('csrf-token');
    expect(call?.[1]).toEqual({ operation: 'approve', requestId: 'chg_1' });
  });
});
