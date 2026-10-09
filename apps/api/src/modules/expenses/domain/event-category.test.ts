import { describe, expect, it } from 'vitest';
import { EXPENSE_CATEGORIES } from '@vehicle-os/domain';
import { categoryAfterEdit, categoryForEventType, eventTypeForCategory } from './event-category';

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
