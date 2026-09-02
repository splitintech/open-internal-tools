import { createQrDataUrl, isBrowserOnline, isInstalledPwa, subscribeOnlineStatus } from './environment.ts';
import { loadBrowserPlugin } from './plugins.ts';
import { forgetTransientSecret, peekTransientSecret, rememberLaunchSecrets } from './secrets.ts';
import {
  TERMINAL_STATUSES,
  type BrowserPluginHandle,
  type PresentedSession,
  type PresentSessionInput,
  type VerificationStatusEnvelope,
  type VerificationWebControllerOptions,
} from './types.ts';

export function createVerificationWebController(options: VerificationWebControllerOptions) {
  const now = options.now ?? (() => new Date());

  async function refresh(attemptId: string): Promise<VerificationStatusEnvelope> {
    const envelope = await options.refreshStatus(attemptId);
    rememberLaunchSecrets(attemptId, envelope.launch);
    return envelope;
  }

  async function present(input: PresentSessionInput): Promise<PresentedSession> {
    let envelope = input.envelope;
    rememberLaunchSecrets(envelope.attemptId, envelope.launch);
    const abort = new AbortController();
    let handle: BrowserPluginHandle | null = null;
    let continuationUrl = continuationLink(envelope);
    const unsubscribe = subscribeOnlineStatus((online) => {
      if (!online) input.onMessage?.('You are offline. Your place is saved. Reconnect to resume verification.');
      else void refreshAndEmit();
    });

    const emit = (next: VerificationStatusEnvelope, message?: string) => {
      envelope = next;
      input.onEnvelopeChange?.(next);
      if (message) input.onMessage?.(message);
    };

    const refreshAndEmit = async (): Promise<VerificationStatusEnvelope> => {
      const next = await refresh(envelope.attemptId);
      const verified = next.status === 'verified';
      emit(next, verified
        ? 'Verified. Returning to your saved action.'
        : 'Your status is not approved yet. The protected action stays saved.');
      return next;
    };

    const presentPlugin = async (): Promise<void> => {
      handle?.destroy();
      handle = null;
      const launch = envelope.launch;
      if (!launch || envelope.presentation === 'none' || TERMINAL_STATUSES.has(envelope.status)) return;
      if (envelope.status === 'processing' || envelope.status === 'manual_review_required') return;
      if (!isBrowserOnline()) return;
      if (launch.transientSecretExpiresAt && Date.parse(launch.transientSecretExpiresAt) <= now().getTime()) {
        forgetTransientSecret(envelope.attemptId);
        input.onMessage?.('The secure launch credential expired. Checking status.');
        await refreshAndEmit();
        return;
      }
      if (envelope.presentation === 'hosted' && launch.hostedUrl) {
        handle = presentHosted(input.container, launch.hostedUrl, () => { void refreshAndEmit(); });
        return;
      }
      if (envelope.presentation === 'qr' && continuationUrl) {
        handle = await presentQr(input.container, continuationUrl, options.renderQr);
        return;
      }
      const plugin = await loadBrowserPlugin(launch.launcherKey, options.plugins);
      if (!plugin) {
        if (launch.hostedUrl) {
          handle = presentHosted(input.container, launch.hostedUrl, () => { void refreshAndEmit(); });
        }
        return;
      }
      handle = await plugin.present({
        container: input.container,
        launch: {
          ...launch,
          transientSecret: peekTransientSecret(envelope.attemptId) ?? launch.transientSecret,
        },
        signal: abort.signal,
        onComplete: () => {
          input.onMessage?.('Verification was submitted. Checking the server-side result now.');
          void refreshAndEmit();
        },
        onPause: () => { void pause(); },
        onError: (message) => input.onMessage?.(message),
        onOpened: () => undefined,
      });
    };

    async function pause(): Promise<void> {
      if (!options.pause) return;
      const result = await options.pause(envelope.attemptId);
      const next = 'attemptId' in result ? result : { ...envelope, status: result.status, canResume: true };
      emit(next as VerificationStatusEnvelope);
    }

    async function resume(): Promise<void> {
      if (!options.resume) return;
      const next = await options.resume(envelope.attemptId);
      emit(next);
      continuationUrl = continuationLink(next);
      await presentPlugin();
    }

    await presentPlugin();

    return {
      continuationUrl,
      destroy() {
        abort.abort();
        unsubscribe();
        handle?.destroy();
        forgetTransientSecret(envelope.attemptId);
      },
      open() {
        handle?.open?.();
      },
      refresh: refreshAndEmit,
      pause,
      resume,
      async retry() {
        if (!options.retry || !envelope.canRetry || !isBrowserOnline()) return;
        const next = await options.retry(envelope.attemptId);
        emit(next);
        continuationUrl = continuationLink(next);
        await presentPlugin();
      },
      async cancel() {
        if (!options.cancel) return;
        const result = await options.cancel(envelope.attemptId);
        const next = 'attemptId' in result ? result : { ...envelope, status: result.status, canResume: false, canRetry: true };
        emit(next as VerificationStatusEnvelope);
      },
    };
  }

  function continuationLink(envelope: VerificationStatusEnvelope): string | null {
    if (!envelope.continuation) return null;
    if (options.createContinuationUrl) return options.createContinuationUrl(envelope.continuation, envelope);
    return envelope.continuation.token;
  }

  return {
    refresh,
    present,
    isOnline: isBrowserOnline,
    isInstalledPwa,
    peekSecret: peekTransientSecret,
  };
}

function presentHosted(container: HTMLElement, url: string, onOpened: () => void): BrowserPluginHandle {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.textContent = 'Open hosted verification';
  anchor.addEventListener('click', onOpened);
  container.replaceChildren(anchor);
  return {
    open() { anchor.click(); },
    destroy() { container.replaceChildren(); },
  };
}

async function presentQr(
  container: HTMLElement,
  url: string,
  renderer?: (value: string) => Promise<string>,
): Promise<BrowserPluginHandle> {
  const image = document.createElement('img');
  image.alt = 'QR code to continue verification on another device';
  const dataUrl = await createQrDataUrl(url, renderer);
  if (dataUrl) image.src = dataUrl;
  else image.dataset.continuation = url;
  container.replaceChildren(image);
  return { destroy() { container.replaceChildren(); } };
}
