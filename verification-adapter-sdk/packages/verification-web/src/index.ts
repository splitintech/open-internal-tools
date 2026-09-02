export { createVerificationWebController } from './controller.ts';
export {
  clientSurface,
  createQrDataUrl,
  isBrowserOnline,
  isInstalledPwa,
  prefersReducedMotion,
  subscribeOnlineStatus,
} from './environment.ts';
export type { VerificationClientSurface } from './environment.ts';
export { clearPluginCache, loadBrowserPlugin } from './plugins.ts';
export {
  forgetAllTransientSecrets,
  forgetTransientSecret,
  peekTransientSecret,
  rememberLaunchSecrets,
  rememberTransientSecret,
  takeTransientSecret,
} from './secrets.ts';
export { STATUS_CONTRACT_VERSION, TERMINAL_STATUSES } from './types.ts';
export type {
  BrowserPlugin,
  BrowserPluginHandle,
  BrowserPluginLoader,
  BrowserPluginPresentInput,
  PresentedSession,
  PresentSessionInput,
  StatusContinuation,
  VerificationStatusEnvelope,
  VerificationWebControllerOptions,
} from './types.ts';
