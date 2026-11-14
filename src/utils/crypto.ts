import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

const getSecretKey = (secret: string): Buffer => {
  return crypto.createHash('sha256').update(secret).digest();
};

export function encrypt(text: string, secret: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(secret), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText: string, secret: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted format');
  }
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const decipher = crypto.createDecipheriv(ALGORITHM, getSecretKey(secret), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Authenticated encryption (AES-256-GCM) for stored OAuth refresh tokens.
 * Format: "v2:<iv>:<tag>:<ciphertext>" (hex). The key must be a private
 * server secret (e.g. 32+ random bytes); unlike CBC above, tampering fails.
 */
export function encryptV2(text: string, key: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(key), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `v2:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`;
}

export function decryptV2(payload: string, key: string): string {
  const [version, ivHex, tagHex, dataHex] = payload.split(':');
  if (version !== 'v2' || !ivHex || !tagHex || dataHex === undefined) {
    throw new Error('Invalid v2 encrypted format');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretKey(key), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
