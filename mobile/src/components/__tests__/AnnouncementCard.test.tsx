import { render, screen } from '@testing-library/react-native';
import { makeAnnouncement } from '../../lib/clutch/fixtures';
import { AnnouncementCard, formatAnnouncementDate } from '../AnnouncementCard';

describe('AnnouncementCard', () => {
  it('shows the title, body, date, author and pinned marker', () => {
    render(
      <AnnouncementCard
        timeZone="America/New_York"
        announcement={makeAnnouncement({
          title: 'Holiday hours',
          body: 'Closed on the 25th.',
          is_pinned: true,
          published_at: '2026-10-12T16:00:00.000Z',
          author_name: 'Front desk',
        })}
      />,
    );
    expect(screen.getByText('Holiday hours')).toBeTruthy();
    expect(screen.getByText('Closed on the 25th.')).toBeTruthy();
    expect(screen.getByText('PINNED')).toBeTruthy();
    expect(screen.getByText('Oct 12 · Front desk')).toBeTruthy();
    expect(screen.getByLabelText('Pinned announcement: Holiday hours')).toBeTruthy();
  });

  it('shows no date and no author when Clutch has neither', () => {
    render(
      <AnnouncementCard
        announcement={makeAnnouncement({ title: 'Undated', published_at: null, author_name: null })}
      />,
    );
    expect(screen.getByText('Undated')).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
    expect(screen.queryByText('PINNED')).toBeNull();
  });

  it('shows the author alone when the announcement is undated', () => {
    render(<AnnouncementCard announcement={makeAnnouncement({ published_at: null, author_name: 'Coach Kim' })} />);
    expect(screen.getByText('Coach Kim')).toBeTruthy();
  });
});

describe('formatAnnouncementDate', () => {
  it('uses the club calendar day', () => {
    // 02:00 UTC on the 13th is still the 12th in New York.
    expect(formatAnnouncementDate('2026-10-13T02:00:00.000Z', 'America/New_York')).toBe('Oct 12');
  });

  it('shows nothing for a null or unparseable timestamp', () => {
    expect(formatAnnouncementDate(null, 'America/New_York')).toBe('');
    expect(formatAnnouncementDate('not a date', 'America/New_York')).toBe('');
  });
});
