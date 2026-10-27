import { newUuid } from './uuid';

describe('newUuid', () => {
  const v4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  it('returns a v4 UUID', () => expect(newUuid()).toMatch(v4));
  it('still works when crypto.randomUUID is unavailable (plain HTTP)', () => {
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      const a = newUuid(), b = newUuid();
      expect(a).toMatch(v4);
      expect(a).not.toBe(b);
    } finally { Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true }); }
  });
});
