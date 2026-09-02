import { afterEach, describe, expect, it, vi } from 'vitest';

import { clientSurface, isBrowserOnline, isInstalledPwa, prefersReducedMotion } from '../src/environment.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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

describe('PWA and offline environment', () => {
  it('detects an installed PWA via display-mode standalone', () => {
    mockMatchMedia((query) => query.includes('display-mode: standalone'));
    expect(isInstalledPwa()).toBe(true);
  });

  it('reports a non-standalone browser as not installed', () => {
    mockMatchMedia(() => false);
    expect(isInstalledPwa()).toBe(false);
  });

  it('reports offline when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(isBrowserOnline()).toBe(false);
  });

  it('detects prefers-reduced-motion', () => {
    mockMatchMedia((query) => query.includes('prefers-reduced-motion: reduce'));
    expect(prefersReducedMotion()).toBe(true);
  });

  it('classifies desktop, mobile-web, and installed-pwa surfaces', () => {
    mockMatchMedia(() => false);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    expect(clientSurface()).toBe('desktop');
    mockMatchMedia((query) => query.includes('max-width: 640px'));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    expect(clientSurface()).toBe('mobile-web');
    mockMatchMedia((query) => query.includes('display-mode: standalone'));
    expect(clientSurface()).toBe('installed-pwa');
  });
});
