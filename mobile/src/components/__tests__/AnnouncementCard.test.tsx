import { render, screen } from '@testing-library/react-native';
import { AnnouncementCard, formatAnnouncementDate } from '../AnnouncementCard';

describe('AnnouncementCard', () => {
  it('shows the title, body, date and pinned marker', () => {
    render(
      <AnnouncementCard
        timeZone="America/New_York"
        announcement={{
          id: 'a1',
          title: 'Holiday hours',
          body: 'Closed on the 25th.',
          isPinned: true,
          publishedAt: '2026-10-12T16:00:00.000Z',
          authorName: 'Front desk',
        }}
      />,
    );
    expect(screen.getByText('Holiday hours')).toBeTruthy();
    expect(screen.getByText('Closed on the 25th.')).toBeTruthy();
    expect(screen.getByText('PINNED')).toBeTruthy();
    expect(screen.getByText('Oct 12 · Front desk')).toBeTruthy();
  });
});

describe('formatAnnouncementDate', () => {
  it('uses the club calendar day', () => {
    // 02:00 UTC on the 13th is still the 12th in New York.
    expect(formatAnnouncementDate('2026-10-13T02:00:00.000Z', 'America/New_York')).toBe('Oct 12');
  });

  it('shows nothing for an unparseable timestamp', () => {
    expect(formatAnnouncementDate('not a date', 'America/New_York')).toBe('');
  });
});
