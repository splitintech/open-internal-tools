import type {
  ProviderLaunchEnvelope,
  VerificationCanonicalStatus,
  VerificationLaunchPresentation,
  VerificationPackageCode,
} from '@splitin/verification-adapter-sdk';

export const STATUS_CONTRACT_VERSION = '1.0.0' as const;

export interface StatusContinuation {
  key: string;
  token: string;
  expiresAt: string;
}

export interface VerificationStatusEnvelope {
  contractVersion?: typeof STATUS_CONTRACT_VERSION | string;
  attemptId: string;
  packageCode: VerificationPackageCode;
  status: VerificationCanonicalStatus;
  presentation: VerificationLaunchPresentation;
  launch: ProviderLaunchEnvelope | null;
  launcherKey: string | null;
  providerDisclosure: string | null;
  safeErrorCode: string | null;
  retryAfter: string | null;
  supportPath: string | null;
  expiresAt: string | null;
  canResume: boolean;
  canRetry: boolean;
  continuation: StatusContinuation | null;
}

export interface BrowserPluginHandle {
  open?(): void;
  destroy(): void;
}

export interface BrowserPluginPresentInput {
  container: HTMLElement;
  launch: ProviderLaunchEnvelope;
  onComplete: () => void;
  onPause: () => void;
  onError: (message: string) => void;
  onOpened: () => void;
  signal?: AbortSignal;
}

export interface BrowserPlugin {
  launcherKey: string;
  present(input: BrowserPluginPresentInput): Promise<BrowserPluginHandle>;
}

export type BrowserPluginLoader = () => Promise<BrowserPlugin | { default: BrowserPlugin }>;

export interface VerificationWebControllerOptions {
  plugins: Record<string, BrowserPlugin | BrowserPluginLoader>;
  refreshStatus: (attemptId: string) => Promise<VerificationStatusEnvelope>;
  pause?: (attemptId: string) => Promise<VerificationStatusEnvelope | { status: VerificationCanonicalStatus }>;
  resume?: (attemptId: string) => Promise<VerificationStatusEnvelope>;
  retry?: (attemptId: string) => Promise<VerificationStatusEnvelope>;
  cancel?: (attemptId: string) => Promise<VerificationStatusEnvelope | { status: VerificationCanonicalStatus }>;
  createContinuationUrl?: (continuation: StatusContinuation, envelope: VerificationStatusEnvelope) => string;
  renderQr?: (value: string) => Promise<string>;
  now?: () => Date;
}

export interface PresentSessionInput {
  envelope: VerificationStatusEnvelope;
  container: HTMLElement;
  onEnvelopeChange?: (envelope: VerificationStatusEnvelope) => void;
  onMessage?: (message: string) => void;
}

export interface PresentedSession {
  destroy(): void;
  open(): void;
  refresh(): Promise<VerificationStatusEnvelope>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  retry(): Promise<void>;
  cancel(): Promise<void>;
  continuationUrl: string | null;
}

export const TERMINAL_STATUSES = new Set<VerificationCanonicalStatus>([
  'verified',
  'declined',
  'failed',
  'expired',
  'canceled',
  'redacted',
]);
