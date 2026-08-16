import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { Platform } from '../../../shared/types.js';

/**
 * OAuth handoff state.
 *
 * The authorize redirect leaves our origin, so we need somewhere to park the
 * PKCE verifier and the initiating user id until the provider redirects back.
 * Rather than a database round-trip, the payload rides in an HMAC-signed,
 * httpOnly cookie: tamper-evident, short-lived, and self-cleaning.
 */

const COOKIE_NAME = 'traction_oauth';
const TTL_MS = 10 * 60 * 1000;

export interface OAuthState {
  userId: string;
  platform: Platform;
  nonce: string;
  codeVerifier?: string;
  /** Where to send the browser once the connection completes. */
  returnTo: string;
  issuedAt: number;
}

function signingKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is required to sign OAuth state.');
  return Buffer.from(raw, 'base64');
}

function sign(payload: string): string {
  return createHmac('sha256', signingKey()).update(payload).digest('base64url');
}

export function encodeState(state: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function decodeState(token: string): OAuthState | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OAuthState;
    if (Date.now() - state.issuedAt > TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}

/** RFC 7636 PKCE pair. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createNonce(): string {
  return randomBytes(16).toString('base64url');
}

export function serializeCookie(value: string): string {
  return [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${TTL_MS / 1000}`,
  ].join('; ');
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readCookie(req: Request): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}
