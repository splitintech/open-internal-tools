export function isBrowserOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
  const iosStandalone = 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return Boolean(standalone || iosStandalone);
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
}

export type VerificationClientSurface = 'desktop' | 'mobile-web' | 'installed-pwa';

export function clientSurface(width?: number): VerificationClientSurface {
  if (isInstalledPwa()) return 'installed-pwa';
  if (typeof window === 'undefined') return 'desktop';
  const viewport = width ?? window.innerWidth;
  if (viewport <= 640 || Boolean(window.matchMedia?.('(max-width: 640px)')?.matches)) return 'mobile-web';
  return 'desktop';
}

export function subscribeOnlineStatus(listener: (online: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

export async function createQrDataUrl(
  value: string,
  renderer?: (text: string) => Promise<string>,
): Promise<string | null> {
  if (!renderer) return null;
  try {
    return await renderer(value);
  } catch {
    return null;
  }
}
