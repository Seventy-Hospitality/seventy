import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { clutch, type CourtAvailability } from '../../lib/clutch';
import { availabilityQuery } from '../../lib/queries';
import { EmptyStateView, PrimaryButton, Skeleton } from '../../components';
import { colors, fonts, radius, spacing } from '../../theme/tokens';
import {
  buildDateStrip,
  dateKeyToDate,
  formatDuration,
  formatMoney,
  formatSlotTime,
  formatStripDay,
  pruneSelection,
  selectionRange,
  sportLabel,
  todayDateKey,
  toggleSlot,
  type TimeRange,
} from './booking';
import {
  durationProblem,
  gridSlotMinutes,
  pickCourt,
  takenTimesFor,
  timesFor,
  withinHours,
  type OwnRange,
} from './court-picker';
import type { SportRules } from './club-rules';
import { quoteQuery } from './quote';
import { SlotPill, TakenSlotRow } from './SlotPill';
import { StepShell } from './StepShell';

/** Days shown before "More dates" expands the rail to the full horizon. */
const INITIAL_STRIP_DAYS = 7;

export interface TimePick {
  court: CourtAvailability;
  date: string;
  range: TimeRange;
}

export interface SelectTimeStepProps {
  /** The court_type being booked. */
  sport: string;
  /** The club's IANA zone: the rail's "today". */
  timezone: string;
  rules: SportRules;
  date: string;
  onDateChange: (date: string) => void;
  /** Selected slot starts ("HH:MM"), contiguous. */
  slots: string[];
  onSlotsChange: (slots: string[]) => void;
  /** Reschedule: the booking being moved, whose own slots count as free on its date. */
  own?: (OwnRange & { date: string }) | null;
  /** Alert shown after a failure bounced the member back here. */
  notice: string | null;
  onDismissNotice: () => void;
  onContinue: (pick: TimePick) => void;
  title?: string;
  continueLabel?: string;
  /** Extra gate on Continue (reschedule: the range must actually change). */
  continueDisabled?: boolean;
  /** Why the extra gate holds Continue back ("Pick a new time"). */
  continueDisabledReason?: string;
  /**
   * Show a new booking's total for the range. Off for a move: a move is
   * priced by its own reschedule quote, never the new-booking quote.
   */
  showTotal?: boolean;
}

/**
 * Choose a date and a time range for a sport. The date rail runs from the
 * club's today to booking_rules.advance_booking_days ahead. The time list is
 * the day's availability grid folded by sport: a start time shows when at
 * least one court of the sport is free, with the grid's price. The member
 * picks a contiguous range; the app names the one court free for all of it
 * (pickCourt). With Clutch P4 the footer shows the quote's total (tax
 * included) for that court and range; without it there is no quote, and the
 * footer says the total is shown at payment. Per-sport opening hours (P4)
 * trim the offered starts.
 */
export function SelectTimeStep({
  sport,
  timezone,
  rules,
  date,
  onDateChange,
  slots,
  onSlotsChange,
  own = null,
  notice,
  onDismissNotice,
  onContinue,
  title,
  continueLabel = 'Continue',
  continueDisabled = false,
  continueDisabledReason,
  showTotal = true,
}: SelectTimeStepProps) {
  const strip = useMemo(
    () => buildDateStrip(todayDateKey(timezone), rules.advance_booking_days),
    [timezone, rules.advance_booking_days],
  );
  const [expanded, setExpanded] = useState(() => strip.indexOf(date) >= INITIAL_STRIP_DAYS);
  const visibleStrip = expanded ? strip : strip.slice(0, INITIAL_STRIP_DAYS);

  const grid = useQuery(availabilityQuery(date));
  const ownToday = own && own.date === date ? own : null;
  const dayOfWeek = dateKeyToDate(date).getDay();
  const options = useMemo(
    () =>
      grid.data
        ? timesFor(grid.data, sport, { own: ownToday }).filter((option) =>
            withinHours(option.start, option.end, rules.hours, dayOfWeek),
          )
        : [],
    [grid.data, sport, ownToday, rules.hours, dayOfWeek],
  );
  const offered = useMemo(() => options.map((option) => option.start), [options]);
  const slotMinutes = rules.slot_duration_minutes || (grid.data ? gridSlotMinutes(grid.data) : null) || 60;

  // Free and fully booked starts in one list: a booked start shows as taken,
  // so a gap in the day reads as "booked", not as a missing time.
  const rows = useMemo(() => {
    if (!grid.data) return [];
    const taken = takenTimesFor(grid.data, sport, { own: ownToday })
      .filter((time) => withinHours(time.start, time.end, rules.hours, dayOfWeek))
      .map((time) => ({ kind: 'taken' as const, ...time }));
    return [...options.map((option) => ({ kind: 'free' as const, start: option.start, option })), ...taken].sort(
      (a, b) => a.start.localeCompare(b.start),
    );
  }, [grid.data, sport, ownToday, rules.hours, dayOfWeek, options]);

  // Says what a refresh took out of the selection.
  const [pruned, setPruned] = useState<string | null>(null);

  // A refetch can take a selected start away (someone else booked it): prune
  // so the selection never holds a time that is not offered, and say so.
  useEffect(() => {
    if (!grid.isSuccess) return;
    const offeredSet = new Set(offered);
    const gone = slots.filter((slot) => !offeredSet.has(slot));
    if (gone.length === 0) return;
    const kept = pruneSelection(slots, offered, slotMinutes);
    const first = [...gone].sort((a, b) => a.localeCompare(b))[0];
    setPruned(
      kept.length > 0
        ? `${formatSlotTime(first)} was just booked, so your selection was shortened.`
        : `${formatSlotTime(first)} was just booked. Pick another time.`,
    );
    onSlotsChange(kept);
  }, [grid.isSuccess, offered, slots, onSlotsChange, slotMinutes]);

  const range = selectionRange(slots, slotMinutes);
  const court =
    range && grid.data ? pickCourt(grid.data, sport, range.start, range.end, { own: ownToday }) : null;
  const problem = range ? durationProblem(range.minutes, rules) : null;
  const ready = !!range && !!court && !problem;

  const parity = clutch.capabilities.bookingParity;
  const quote = useQuery(
    quoteQuery(
      showTotal && ready && court && range
        ? {
            court_id: court.court_id,
            date,
            start_time: range.start,
            end_time: range.end,
          }
        : null,
    ),
  );

  const hint = !range
    ? null
    : problem === 'too_short'
      ? `Book at least ${formatDuration(rules.min_duration_minutes ?? 0)}.`
      : problem === 'too_long'
        ? `Book at most ${formatDuration(rules.max_duration_minutes ?? 0)}.`
        : !court
          ? 'No single court is free for that whole time. Shorten it or pick another start.'
          : null;

  const canContinue = ready && !continueDisabled;
  // Why Continue is dimmed, in one line (an error hint above says it already).
  const blockedReason =
    canContinue || hint
      ? null
      : !range
        ? 'Pick a time to continue'
        : continueDisabled
          ? (continueDisabledReason ?? null)
          : null;

  return (
    <StepShell
      title={title ?? `Book ${sportLabel(sport).toLowerCase()}`}
      footer={
        <View style={styles.footer}>
          {ready && court && range ? (
            <View style={styles.summary} accessibilityLiveRegion="polite">
              <Text style={styles.summaryCourt} numberOfLines={1}>
                {court.court_name} · {formatDuration(range.minutes)}
              </Text>
              {showTotal ? (
                <Text style={styles.summaryTotal}>
                  {!parity
                    ? 'Total shown at payment'
                    : quote.data
                      ? `Total ${formatMoney(quote.data.total_cents, quote.data.currency)}`
                      : quote.isPending
                        ? 'Pricing...'
                        : 'Total shown at payment'}
                </Text>
              ) : null}
            </View>
          ) : null}
          {blockedReason ? (
            <Text style={styles.blockedReason} accessibilityLiveRegion="polite">
              {blockedReason}
            </Text>
          ) : null}
          <PrimaryButton
            label={continueLabel}
            disabled={!canContinue}
            onPress={canContinue && court && range ? () => onContinue({ court, date, range }) : undefined}
            variant={canContinue ? 'primary' : 'ghost'}
          />
        </View>
      }
    >
      {notice ? (
        <View style={styles.noticeBox} accessibilityRole="alert">
          <Text style={styles.noticeText}>{notice}</Text>
          <Pressable accessibilityRole="button" onPress={onDismissNotice} style={styles.textButton}>
            <Text style={styles.noticeDismiss}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>Select date</Text>
        {!expanded && strip.length > INITIAL_STRIP_DAYS ? (
          <Pressable accessibilityRole="button" onPress={() => setExpanded(true)} style={styles.textButton}>
            <Text style={styles.sectionLink}>More dates</Text>
          </Pressable>
        ) : null}
      </View>

      <DateStrip
        dates={visibleStrip}
        value={date}
        onChange={(next) => {
          onDismissNotice();
          setPruned(null);
          onDateChange(next);
        }}
      />

      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>Select times</Text>
      </View>

      {pruned ? (
        <Text style={styles.prunedNotice} accessibilityRole="alert">
          {pruned}
        </Text>
      ) : null}

      {hint ? (
        <Text style={styles.hint} accessibilityRole="alert">
          {hint}
        </Text>
      ) : options.length > 0 && slots.length < 2 ? (
        <Text style={styles.howTo}>Tap a start time, then the next times to book longer.</Text>
      ) : null}

      {grid.isPending ? (
        <View style={styles.slotList} accessibilityLabel="Loading available times">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height={56} borderRadius={radius.md} />
          ))}
        </View>
      ) : grid.isError ? (
        <View style={styles.errorBox} accessibilityRole="alert">
          <Text style={styles.errorText}>We could not load the available times.</Text>
          <PrimaryButton label="Try again" variant="secondary" onPress={() => void grid.refetch()} />
        </View>
      ) : options.length === 0 ? (
        <EmptyStateView
          title="No available times"
          description={`Every ${sportLabel(sport).toLowerCase()} court is taken this day. Try another date.`}
        />
      ) : (
        <View style={styles.slotList} accessibilityRole="list">
          {rows.map((row) =>
            row.kind === 'taken' ? (
              <TakenSlotRow key={row.start} start={row.start} end={row.end} />
            ) : (
              <SlotPill
                key={row.start}
                option={row.option}
                selected={slots.includes(row.start)}
                onToggle={() => {
                  onDismissNotice();
                  setPruned(null);
                  onSlotsChange(toggleSlot(slots, row.start, slotMinutes));
                }}
              />
            ),
          )}
        </View>
      )}
    </StepShell>
  );
}

function DateStrip({
  dates,
  value,
  onChange,
}: {
  dates: string[];
  value: string;
  onChange: (date: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.dateStrip}
      accessibilityRole="radiogroup"
      accessibilityLabel="Select date"
    >
      {dates.map((key) => {
        const parts = formatStripDay(key);
        const selected = key === value;
        return (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={parts.label}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.dateTile,
              selected ? styles.dateTileSelected : null,
              pressed ? styles.dateTilePressed : null,
            ]}
          >
            <Text style={[styles.dateWeekday, selected ? styles.dateTextSelected : null]}>
              {parts.weekday}
            </Text>
            <Text style={[styles.dateDay, selected ? styles.dateTextSelected : null]}>{parts.day}</Text>
            <Text style={[styles.dateMonth, selected ? styles.dateTextSelected : null]}>{parts.month}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: spacing.sm,
  },
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryCourt: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  summaryTotal: {
    color: colors.text,
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  sectionLink: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
  },
  hint: {
    color: colors.danger,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  howTo: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
  },
  prunedNotice: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  },
  blockedReason: {
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 13,
    textAlign: 'center',
  },
  textButton: {
    minHeight: 44,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  dateStrip: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
  },
  dateTile: {
    width: 58,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateTileSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  dateTilePressed: {
    opacity: 0.9,
  },
  dateWeekday: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 11,
    letterSpacing: 0.6,
  },
  dateDay: {
    color: colors.text,
    fontFamily: fonts.displayBold,
    fontSize: 18,
  },
  dateMonth: {
    color: colors.textMuted,
    fontFamily: fonts.bodySemibold,
    fontSize: 10,
    letterSpacing: 0.6,
  },
  dateTextSelected: {
    color: colors.textOnAccent,
  },
  slotList: {
    gap: spacing.sm,
  },
  noticeBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.dangerStrong,
    backgroundColor: colors.surfaceOverlay,
  },
  noticeText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 19,
  },
  noticeDismiss: {
    color: colors.accent,
    fontFamily: fonts.bodySemibold,
    fontSize: 13,
  },
  errorBox: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  errorText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 14,
  },
});
