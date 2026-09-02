import type { ActorContext } from '@splitin/verification-adapter-sdk';

import { createVerificationFetchHandler } from './handler.ts';
import type { VerificationFetchHandlerOptions, VerificationServerPlatform } from './types.ts';

export interface SupabaseUserLike {
  id: string;
  role?: string | null;
  email?: string | null;
}

export interface VerificationSupabaseOptions extends Omit<VerificationFetchHandlerOptions, 'resolveActor'> {
  getUser(request: Request): Promise<SupabaseUserLike | null>;
  resolveActor(request: Request, user: SupabaseUserLike | null): Promise<ActorContext>;
}

/**
 * Supabase/Edge binding. Request is already a Web API Request; this adapter
 * only maps getUser() into resolveActor.
 */
export function createVerificationSupabaseHandler(
  platform: VerificationServerPlatform,
  options: VerificationSupabaseOptions,
): (request: Request) => Promise<Response> {
  return createVerificationFetchHandler(platform, {
    allowedOrigins: options.allowedOrigins,
    isCookieAuthenticated: options.isCookieAuthenticated,
    basePath: options.basePath,
    maxBodyBytes: options.maxBodyBytes,
    supportPath: options.supportPath,
    rateLimit: options.rateLimit,
    resolveActor: async (request) => {
      const user = await options.getUser(request);
      return options.resolveActor(request, user);
    },
  });
}
