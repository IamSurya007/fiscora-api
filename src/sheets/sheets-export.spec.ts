import { columnLetter, mergeById, range } from './sheets-export';

const header = ['ID', 'Amount', 'Status'];

describe('mergeById', () => {
  it('keeps existing rows in place, updates them, appends new ones', () => {
    const existing = [header, ['b', '20', 'Active'], ['a', '10', 'Active']];
    const current = new Map([
      ['a', ['a', 11, 'Active']],
      ['b', ['b', 20, 'Active']],
      ['c', ['c', 30, 'Active']],
    ]);
    expect(mergeById(header, existing, current)).toEqual([
      header,
      ['b', 20, 'Active'],
      ['a', 11, 'Active'],
      ['c', 30, 'Active'],
    ]);
  });

  it('marks rows that no longer exist as Deleted instead of removing them', () => {
    const existing = [header, ['gone', '5', 'Active'], ['kept', '7', 'Active']];
    const current = new Map([['kept', ['kept', 7, 'Active']]]);
    expect(mergeById(header, existing, current)).toEqual([
      header,
      ['gone', '5', 'Deleted'],
      ['kept', 7, 'Active'],
    ]);
  });

  it('starts a fresh tab with the header', () => {
    expect(mergeById(header, [], new Map([['x', ['x', 1, 'Active']]]))).toEqual([header, ['x', 1, 'Active']]);
  });
});

it('quotes tab names and builds column letters', () => {
  expect(range('Fiscora · Transactions', 'A1')).toBe("'Fiscora · Transactions'!A1");
  expect(columnLetter(15)).toBe('O');
  expect(columnLetter(27)).toBe('AA');
});
