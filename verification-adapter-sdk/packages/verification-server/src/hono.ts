import type { ActorContext } from '@splitin/verification-adapter-sdk';

import { createVerificationFetchHandler } from './handler.ts';
import type { VerificationFetchHandlerOptions, VerificationServerPlatform } from './types.ts';

export interface HonoContextLike {
  req: { raw: Request };
}

export interface HonoAppLike {
  all(path: string, handler: (context: HonoContextLike) => Response | Promise<Response>): unknown;
}

export interface VerificationHonoOptions extends VerificationFetchHandlerOptions {
  resolveHonoActor?(context: HonoContextLike): Promise<ActorContext>;
}

/**
 * Hono binding. Uses the native Web Request on the context.
 */
export function createVerificationHonoHandler(
  platform: VerificationServerPlatform,
  options: VerificationHonoOptions,
) {
  return async (context: HonoContextLike): Promise<Response> => {
    const handler = createVerificationFetchHandler(platform, {
      ...options,
      resolveActor: options.resolveHonoActor
        ? async () => options.resolveHonoActor!(context)
        : options.resolveActor,
    });
    return handler(context.req.raw);
  };
}

export function mountVerificationHono(
  app: HonoAppLike,
  platform: VerificationServerPlatform,
  options: VerificationHonoOptions,
): void {
  const handler = createVerificationHonoHandler(platform, options);
  app.all('/v1', handler);
  app.all('/v1/*', handler);
}
