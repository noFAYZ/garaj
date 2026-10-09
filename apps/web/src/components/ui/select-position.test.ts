import { describe, expect, it } from 'vitest';
import { matchTypeahead, nextEnabled, placeList } from './select-position';

const viewport = { width: 1000, height: 800 };

describe('placeList', () => {
  it('opens below when there is room, at least as wide as the trigger', () => {
    expect(
      placeList(
        { top: 100, bottom: 140, left: 50, width: 200 },
        { height: 200, width: 180 },
        viewport,
      ),
    ).toEqual({ up: false, maxHeight: 320, top: 146, left: 50 });
  });

  it('flips above when it does not fit below and there is more room above', () => {
    const spot = placeList(
      { top: 700, bottom: 740, left: 50, width: 200 },
      { height: 200, width: 200 },
      viewport,
    );
    expect(spot.up).toBe(true);
    expect(spot.top).toBe(700 - 6 - 200);
  });

  it('pulls the list back inside the right edge', () => {
    const spot = placeList(
      { top: 100, bottom: 140, left: 900, width: 200 },
      { height: 100, width: 200 },
      viewport,
    );
    expect(spot.left).toBe(1000 - 200 - 8);
  });

  it('never squeezes the list below its minimum, and scrolls it instead', () => {
    const spot = placeList(
      { top: 130, bottom: 170, left: 0, width: 100 },
      { height: 400, width: 100 },
      { width: 400, height: 300 },
    );
    expect(spot).toMatchObject({ up: false, maxHeight: 120, top: 176, left: 8 });
  });
});

describe('nextEnabled', () => {
  const disabled = [false, true, false];

  it('steps over disabled options and wraps', () => {
    expect(nextEnabled(disabled, 0, 1)).toBe(2);
    expect(nextEnabled(disabled, 2, 1)).toBe(0);
    expect(nextEnabled(disabled, 0, -1)).toBe(2);
  });

  it('starts from the matching end when nothing is active', () => {
    expect(nextEnabled(disabled, -1, 1)).toBe(0);
    expect(nextEnabled(disabled, -1, -1)).toBe(2);
  });

  it('finds nothing when every option is disabled', () => {
    expect(nextEnabled([true, true], 0, 1)).toBe(-1);
    expect(nextEnabled([], -1, 1)).toBe(-1);
  });
});

describe('matchTypeahead', () => {
  const labels = ['Car', 'Van', 'Motorcycle', 'Moped', 'Boat'];
  const none = labels.map(() => false);

  it('cycles through options sharing a first letter', () => {
    expect(matchTypeahead(labels, none, 'm', -1)).toBe(2);
    expect(matchTypeahead(labels, none, 'm', 2)).toBe(3);
    expect(matchTypeahead(labels, none, 'm', 3)).toBe(2);
    expect(matchTypeahead(labels, none, 'mm', 2)).toBe(3);
  });

  it('keeps the current option while a longer prefix still matches it', () => {
    expect(matchTypeahead(labels, none, 'mo', 2)).toBe(2);
    expect(matchTypeahead(labels, none, 'mop', 2)).toBe(3);
  });

  it('skips disabled options and reports no match', () => {
    const disabled = [false, false, false, true, false];
    expect(matchTypeahead(labels, disabled, 'm', 2)).toBe(2);
    expect(matchTypeahead(labels, none, 'z', 0)).toBe(-1);
  });
});
