import { QueryFailedError } from 'typeorm';
import { isDuplicateEntry } from './duplicate-entry';

describe('isDuplicateEntry', () => {
  it('detects a MySQL duplicate key error', () => {
    const driverError = Object.assign(
      new Error("Duplicate entry 'abc' for key 'PRIMARY'"),
      {
        code: 'ER_DUP_ENTRY',
        errno: 1062,
      },
    );

    expect(
      isDuplicateEntry(new QueryFailedError('INSERT', [], driverError)),
    ).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isDuplicateEntry(new Error('connection reset'))).toBe(false);
  });
});
