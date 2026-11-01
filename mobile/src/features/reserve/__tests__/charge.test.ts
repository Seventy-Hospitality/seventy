import { makeLegacyCheckout, makeQuote } from '../../../lib/clutch/fixtures';
import { chargeFromBookingCheckout, chargeFromQuote, chargeLines, chargeTotal, isFinalCharge } from '../charge';

describe('a quote whose tax is priced at payment', () => {
  const quote = chargeFromQuote(
    makeQuote({ price_cents: 3000, tax_cents: 0, total_cents: 3000, tax_status: 'at_checkout' }),
  );

  it('names no total, so the Pay button names no amount', () => {
    expect(chargeTotal(quote)).toBeNull();
    expect(isFinalCharge(quote)).toBe(false);
  });

  it('says the tax and the total are shown at payment', () => {
    expect(chargeLines(quote)).toEqual([
      { label: 'Court price', value: '$30.00' },
      { label: 'Tax', value: 'Calculated at payment' },
      { label: 'Total', value: 'Shown at payment', total: true },
    ]);
  });

  it('a quote with its tax calculated is final', () => {
    const calculated = chargeFromQuote(
      makeQuote({ price_cents: 3000, tax_cents: 240, total_cents: 3240, tax_status: 'calculated' }),
    );
    expect(chargeTotal(calculated)).toBe('$32.40');
    expect(isFinalCharge(calculated)).toBe(true);
  });
});

describe('a booking payment intent', () => {
  it('that states its total is what the card is charged', () => {
    const charge = chargeFromBookingCheckout(
      makeLegacyCheckout({ subtotalCents: 3000, taxAmountCents: 240, total_cents: 3240 }),
      'USD',
    );
    expect(charge).toEqual({ kind: 'checkout', currency: 'USD', subtotal_cents: 3000, tax_cents: 240, total_cents: 3240 });
    expect(chargeTotal(charge)).toBe('$32.40');
  });

  it('that states no total is two lines, never summed', () => {
    const charge = chargeFromBookingCheckout(makeLegacyCheckout({ subtotalCents: 3000, taxAmountCents: 240 }), 'USD');
    expect(charge.kind).toBe('split');
    expect(chargeTotal(charge)).toBeNull();
  });
});
