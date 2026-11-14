import { decryptV2, encryptV2 } from './crypto';

describe('encryptV2', () => {
  it('round-trips', () => {
    expect(decryptV2(encryptV2('refresh-token', 'k'), 'k')).toBe('refresh-token');
  });
  it('rejects a wrong key or tampered data', () => {
    const sealed = encryptV2('refresh-token', 'k');
    expect(() => decryptV2(sealed, 'other')).toThrow();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith('0') ? '1' : '0');
    expect(() => decryptV2(tampered, 'k')).toThrow();
  });
});
