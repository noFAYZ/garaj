import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords, toCsv } from './csv';

describe('toCsv', () => {
  it('quotes only the fields that need it, and doubles inner quotes', () => {
    const csv = toCsv(['a', 'b', 'c'], [{ a: 'plain', b: 'has, comma', c: 'say "hi"' }]);
    expect(csv).toBe('a,b,c\r\nplain,"has, comma","say ""hi"""\r\n');
  });

  it('writes an empty field for null rather than the word null', () => {
    expect(toCsv(['a'], [{ a: null }])).toBe('a\r\n\r\n');
  });
});

describe('parseCsv', () => {
  it('keeps separators and newlines that sit inside a quoted field', () => {
    expect(parseCsv('a,b\r\n"one, two","line\nbreak"\r\n')).toEqual([
      ['a', 'b'],
      ['one, two', 'line\nbreak'],
    ]);
  });

  it('strips a BOM, so a quoted first header is still read as quoted', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseCsv(bom + '"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('round-trips what toCsv produced', () => {
    const rows = [{ a: 'x,y', b: 'q"q' }];
    expect(parseCsv(toCsv(['a', 'b'], rows))).toEqual([
      ['a', 'b'],
      ['x,y', 'q"q'],
    ]);
  });
});

describe('parseCsvRecords', () => {
  it('normalises header spellings to one key', () => {
    const { rows } = parseCsvRecords('Odometer (km),Total Cost\r\n1000,42.50\r\n');
    expect(rows[0]).toEqual({ odometerkm: '1000', totalcost: '42.50' });
  });

  it('survives a BOM on the first header', () => {
    const { rows } = parseCsvRecords(`${String.fromCharCode(0xfeff)}Date\r\n2024-01-01\r\n`);
    expect(rows[0]).toEqual({ date: '2024-01-01' });
  });
});
