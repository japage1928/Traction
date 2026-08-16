import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for OAuth tokens at rest.
 *
 * Stored format is `v1.<iv>.<authTag>.<ciphertext>`, each part base64. The
 * version prefix means a future key rotation can decrypt old rows while
 * writing new ones in a newer scheme.
 */

const VERSION = 'v1';

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY is not set. Generate one with: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}.`);
  }
  return buf;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptToken(envelope: string): string {
  const [version, ivB64, tagB64, dataB64] = envelope.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed token envelope.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** True when a usable encryption key is configured, without throwing. */
export function hasEncryptionKey(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
