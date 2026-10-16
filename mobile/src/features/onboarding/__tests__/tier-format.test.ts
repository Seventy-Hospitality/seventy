import { makeTier } from '../../../lib/clutch/fixtures';
import { asTierId } from '../../../lib/clutch';
import {
  benefitLines,
  defaultInterval,
  formatCents,
  formatCentsExact,
  intervalSuffix,
  intervalsOffered,
  tiersForInterval,
} from '../tier-format';

const monthly = makeTier({ id: asTierId('t-month'), interval: 'monthly', sort_order: 2 });
const yearly = makeTier({ id: asTierId('t-year'), interval: 'yearly', price_cents: 99_000, sort_order: 1 });
const quarterly = makeTier({ id: asTierId('t-q'), interval: 'quarterly', is_active: false });

describe('tier formatting', () => {
  it('formats Clutch cents in the tier currency without inventing decimals', () => {
    expect(formatCents(9900, 'usd')).toBe('$99');
    expect(formatCents(5250, 'USD')).toBe('$52.50');
    expect(formatCentsExact(9900, 'USD')).toBe('$99.00');
  });

  it('names every Clutch billing interval', () => {
    expect(intervalSuffix('monthly')).toBe('/ month');
    expect(intervalSuffix('quarterly')).toBe('/ quarter');
    expect(intervalSuffix('yearly')).toBe('/ year');
  });

  it('offers only intervals of active tiers, in calendar order, defaulting to yearly', () => {
    expect(intervalsOffered([yearly, quarterly, monthly])).toEqual(['monthly', 'yearly']);
    expect(defaultInterval([monthly, yearly])).toBe('yearly');
    expect(defaultInterval([monthly])).toBe('monthly');
  });

  it('lists active tiers of an interval in the club order', () => {
    const second = makeTier({ id: asTierId('t-month-2'), interval: 'monthly', sort_order: 1 });
    expect(tiersForInterval([monthly, second, quarterly], 'monthly').map((t) => t.id)).toEqual([
      't-month-2',
      't-month',
    ]);
    expect(tiersForInterval([quarterly], 'quarterly')).toEqual([]);
  });

  it('shows string benefits and skips anything else', () => {
    expect(benefitLines({ benefits: ['Court booking 14 days out', { x: 1 }, '  ', 3] })).toEqual([
      'Court booking 14 days out',
    ]);
    expect(benefitLines({ benefits: null })).toEqual([]);
  });
});
