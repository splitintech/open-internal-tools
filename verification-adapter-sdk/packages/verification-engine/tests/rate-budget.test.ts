import { describe, expect, it } from 'vitest';

import { createRateBudget } from '../src/rate-budget.ts';

describe('createRateBudget', () => {
  it('allows up to the per-second limit and then requires retry', () => {
    const budget = createRateBudget(2);
    const at = new Date('2026-09-02T20:00:00.000Z');
    expect(budget.consume('stripe_identity', at).allowed).toBe(true);
    expect(budget.consume('stripe_identity', at).allowed).toBe(true);
    const blocked = budget.consume('stripe_identity', at);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(budget.consume('persona', at).allowed).toBe(true);
  });
});
