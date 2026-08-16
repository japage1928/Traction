/**
 * Offline verification of the OAuth plumbing: PKCE derivation, signed-state
 * integrity, authorize-URL construction per provider, scope gating, and the
 * token encryption envelope. No network, no credentials.
 */
import { createHash } from 'node:crypto';
import {
  PROVIDERS,
  buildAuthorizeUrl,
  collectMetrics,
  canReadProfile,
  type ProviderDefinition,
} from '../netlify/functions/_shared/providers.js';
import {
  createPkcePair,
  encodeState,
  decodeState,
  createNonce,
} from '../netlify/functions/_shared/oauth-state.js';
import { encryptToken, decryptToken } from '../netlify/functions/_shared/crypto.js';

let failures = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Credentials for every provider so URL building works.
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.APP_URL = 'https://traction.example';
for (const p of Object.values(PROVIDERS)) {
  process.env[p.clientIdEnv] = `test-${p.platform}-id`;
  process.env[p.clientSecretEnv] = `test-${p.platform}-secret`;
}

console.log('\n1. PKCE');
{
  const { verifier, challenge } = createPkcePair();
  const expected = createHash('sha256').update(verifier).digest('base64url');
  check('challenge is S256(verifier)', challenge === expected);
  check('verifier is base64url only', /^[A-Za-z0-9_-]+$/.test(verifier));
  check('verifier length >= 43 (RFC 7636)', verifier.length >= 43, `got ${verifier.length}`);
  const second = createPkcePair();
  check('verifiers are not reused', verifier !== second.verifier);
}

console.log('\n2. Signed state');
{
  const state = {
    userId: 'user-1',
    platform: 'x' as const,
    nonce: createNonce(),
    codeVerifier: 'v',
    returnTo: '/accounts',
    issuedAt: Date.now(),
  };
  const token = encodeState(state);
  const decoded = decodeState(token);
  check('round-trips', decoded?.userId === 'user-1' && decoded?.platform === 'x');

  const [payload, sig] = token.split('.');
  const tamperedPayload = Buffer.from(
    JSON.stringify({ ...state, userId: 'attacker' }),
  ).toString('base64url');
  check('rejects a swapped payload', decodeState(`${tamperedPayload}.${sig}`) === null);
  check('rejects a mangled signature', decodeState(`${payload}.${sig.slice(0, -2)}xy`) === null);
  check('rejects garbage', decodeState('not-a-token') === null);

  const stale = encodeState({ ...state, issuedAt: Date.now() - 11 * 60 * 1000 });
  check('rejects expired state (>10 min)', decodeState(stale) === null);
}

console.log('\n3. Authorize URLs');
{
  const { challenge } = createPkcePair();
  for (const provider of Object.values(PROVIDERS) as ProviderDefinition[]) {
    const url = new URL(buildAuthorizeUrl(provider, 'STATE123', challenge));
    const q = url.searchParams;
    const ok =
      q.get('response_type') === 'code' &&
      q.get('state') === 'STATE123' &&
      q.get(provider.clientIdParam) === `test-${provider.platform}-id` &&
      q.get('redirect_uri') === `https://traction.example/.netlify/functions/oauth-callback?platform=${provider.platform}`;
    check(`${provider.label}: core params`, ok, url.search.slice(0, 120));

    const scopeParam = q.get('scope') ?? '';
    check(
      `${provider.label}: scopes joined with ${JSON.stringify(provider.scopeSeparator)}`,
      scopeParam === provider.scopes.join(provider.scopeSeparator),
      scopeParam,
    );

    if (provider.usesPkce) {
      check(
        `${provider.label}: sends PKCE challenge`,
        q.get('code_challenge') === challenge && q.get('code_challenge_method') === 'S256',
      );
    } else {
      check(`${provider.label}: omits PKCE (unsupported)`, !q.has('code_challenge'));
    }

    // No secret may ever appear in a URL the browser is redirected to.
    check(
      `${provider.label}: no client secret in authorize URL`,
      !url.toString().includes('test-') || !url.toString().includes('-secret'),
    );
  }

  // TikTok's id parameter is client_key, not client_id — a classic mismatch.
  const tiktok = new URL(buildAuthorizeUrl(PROVIDERS.tiktok, 's', challenge));
  check(
    'TikTok uses client_key, not client_id',
    tiktok.searchParams.has('client_key') && !tiktok.searchParams.has('client_id'),
  );

  // A PKCE provider must refuse to build a URL without a challenge.
  let threw = false;
  try {
    buildAuthorizeUrl(PROVIDERS.x, 'state');
  } catch {
    threw = true;
  }
  check('PKCE provider refuses to build without a challenge', threw);
}

console.log('\n4. Scope gating');
{
  const provider = PROVIDERS.tiktok;
  const profile = { externalId: 'o1', handle: 'demo' };

  // Granting only the profile scope must skip the stats source entirely.
  const partial = await collectMetrics(provider, 'token', profile, ['user.info.basic']);
  check('ungranted source is skipped, not attempted', partial.skipped.length === 1);
  check('skip names the missing scope', partial.skipped[0]?.missingScopes.includes('user.info.stats'));
  check('no network call was made for it', partial.failed.length === 0);
  check('metrics stay zeroed', partial.metrics.followers === 0);

  check('canReadProfile true with basic scope', canReadProfile(provider, ['user.info.basic']));
  check('canReadProfile false without it', !canReadProfile(provider, ['user.info.stats']));

  // Instagram splits audience and insights across two scopes.
  const ig = await collectMetrics(PROVIDERS.instagram, 't', profile, ['instagram_business_basic']);
  check(
    'Instagram insights gated separately from basic',
    ig.skipped.length === 1 && ig.skipped[0].missingScopes.includes('instagram_business_manage_insights'),
  );

  // With zero scopes granted, nothing at all runs.
  const none = await collectMetrics(PROVIDERS.x, 't', profile, []);
  check('no scopes granted means no sources run', none.skipped.length === PROVIDERS.x.metricSources.length);
}

console.log('\n5. Token envelope');
{
  const secret = 'ya29.super-secret-access-token';
  const envelope = encryptToken(secret);
  check('ciphertext does not contain plaintext', !envelope.includes(secret));
  check('round-trips', decryptToken(envelope) === secret);
  check('is versioned', envelope.startsWith('v1.'));

  const a = encryptToken(secret);
  const b = encryptToken(secret);
  check('same plaintext yields different ciphertext (random IV)', a !== b);

  // GCM must reject a tampered payload rather than returning garbage.
  const parts = envelope.split('.');
  const flipped = Buffer.from(parts[3], 'base64');
  flipped[0] ^= 0xff;
  parts[3] = flipped.toString('base64');
  let rejected = false;
  try {
    decryptToken(parts.join('.'));
  } catch {
    rejected = true;
  }
  check('tampered ciphertext is rejected by the auth tag', rejected);
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
