import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES } from '@vehicle-os/domain';
import {
  categoryAfterEdit,
  categoryForEventType,
  eventTypeForCategory,
  measuredInNote,
} from './event-category';

describe('expense category and activity item type', () => {
  it('keeps every category when its own item is edited without changing type', () => {
    for (const category of EXPENSE_CATEGORIES) {
      expect(categoryAfterEdit(category, eventTypeForCategory(category))).toBe(category);
    }
  });

  it('files tax, storage and other uncategorised money as a plain expense item', () => {
    expect(eventTypeForCategory('TAX')).toBe('EXPENSE');
    expect(eventTypeForCategory('STORAGE')).toBe('EXPENSE');
    expect(categoryForEventType('EXPENSE')).toBe('OTHER');
  });

  it('keeps maintenance for an inspection, which files its cost there', () => {
    expect(categoryAfterEdit('MAINTENANCE', 'INSPECTION')).toBe('MAINTENANCE');
  });

  it('refiles the money when the item is retyped to something the category no longer describes', () => {
    expect(categoryAfterEdit('TAX', 'FUEL')).toBe('FUEL');
    expect(categoryAfterEdit('FUEL', 'NOTE')).toBe('OTHER');
  });
});

describe('measuredInNote', () => {
  it('reads the amount the add forms lead a fill note with', () => {
    expect(measuredInNote('20 L')).toEqual({ quantity: '20', unit: 'LITER', fullTank: false });
    expect(measuredInNote('23,5 L · full tank')).toEqual({
      quantity: '23.5',
      unit: 'LITER',
      fullTank: true,
    });
    expect(measuredInNote('32 kWh')).toEqual({ quantity: '32', unit: 'KWH', fullTank: false });
  });

  it('leaves a note that does not start with an amount alone', () => {
    expect(measuredInNote(null)).toBeNull();
    expect(measuredInNote('Topped up 20 L')).toBeNull();
    expect(measuredInNote('0 L')).toBeNull();
    expect(measuredInNote('10 gal')).toBeNull();
    expect(measuredInNote('3 Litres')).toBeNull();
  });
});
