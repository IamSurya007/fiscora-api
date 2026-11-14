import { ownAccountId } from './account-id.util';

const repoWith = (row: { id: string; userId: string } | null) =>
  ({ findOne: jest.fn().mockResolvedValue(row) }) as any;

describe('ownAccountId', () => {
  it('keeps a free id', async () => {
    expect(await ownAccountId(repoWith(null), 'userB', 'default_bank')).toBe(
      'default_bank',
    );
  });

  it("keeps the caller's own id", async () => {
    expect(
      await ownAccountId(
        repoWith({ id: 'default_bank', userId: 'userB' }),
        'userB',
        'default_bank',
      ),
    ).toBe('default_bank');
  });

  it("never reuses another user's id (would move their account)", async () => {
    const id = await ownAccountId(
      repoWith({ id: 'default_bank', userId: 'userA' }),
      'userB',
      'default_bank',
    );
    expect(id).not.toBe('default_bank');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('generates an id when none is requested', async () => {
    expect(await ownAccountId(repoWith(null), 'userB', undefined)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
