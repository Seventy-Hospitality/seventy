/**
 * POST /bookings/quote (Clutch P4): what a range would charge, tax included.
 * One query definition so the time step and checkout share one cached quote.
 * Only enabled with bookingParity on; without it there is no quote and the
 * screens say the total is shown at payment.
 */
import { queryOptions } from '@tanstack/react-query';
import { clutch, type CourtId } from '../../lib/clutch';

export interface QuoteRange {
  court_id: CourtId;
  date: string;
  start_time: string;
  end_time: string;
}

export function quoteQuery(range: QuoteRange | null) {
  return queryOptions({
    queryKey: ['reserve', 'quote', range?.court_id ?? null, range?.date ?? null, range?.start_time ?? null, range?.end_time ?? null],
    queryFn: () => clutch.bookings.quote(range as QuoteRange),
    enabled: !!range && clutch.capabilities.bookingParity,
    retry: false,
    staleTime: 15_000,
  });
}
