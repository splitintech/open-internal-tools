/**
 * Browser launcher for Persona embedded inquiries.
 *
 * Dynamically imports optional peer `persona`. Browser callbacks are UX
 * signals only — they must not be treated as canonical verification decisions.
 * Documents stay at Persona; this plugin never receives document bytes.
 */

export const personaEmbeddedLauncherKey = 'persona_embedded' as const;

export interface PersonaBrowserLaunchInput {
  container?: HTMLElement;
  inquiryId?: string;
  transientSecret?: string;
  environment?: 'sandbox' | 'production';
  onUxSignal?: (signal: 'complete' | 'cancel' | 'error' | 'event') => void;
}

export const personaBrowserPlugin = Object.freeze({
  launcherKey: personaEmbeddedLauncherKey,
  async launch(input: PersonaBrowserLaunchInput): Promise<{ unmount(): void }> {
    const persona = await loadPersona();
    const Client = persona.Client ?? persona.default?.Client;
    if (typeof Client !== 'function') {
      throw new Error('Persona browser SDK did not export Client.');
    }
    const client = new Client({
      inquiryId: input.inquiryId,
      sessionToken: input.transientSecret,
      environment: input.environment,
      onComplete: () => input.onUxSignal?.('complete'),
      onCancel: () => input.onUxSignal?.('cancel'),
      onError: () => input.onUxSignal?.('error'),
      onEvent: () => input.onUxSignal?.('event'),
    });
    client.open();
    return {
      unmount() {
        client.destroy?.();
        input.onUxSignal?.('cancel');
      },
    };
  },
});

async function loadPersona(): Promise<PersonaModule> {
  try {
    return await import('persona') as PersonaModule;
  } catch {
    throw new Error('Optional peer dependency persona is not installed.');
  }
}

interface PersonaClient {
  open(): void;
  destroy?: () => void;
}

interface PersonaModule {
  Client?: new (options: Record<string, unknown>) => PersonaClient;
  default?: { Client?: new (options: Record<string, unknown>) => PersonaClient };
}
