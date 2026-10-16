import { render, screen } from '@testing-library/react-native';
import { Avatar } from '../Avatar';

describe('Avatar', () => {
  it('shows initials when there is no image', () => {
    render(<Avatar name="Alex Morgan" src={null} />);
    expect(screen.getByText('AM')).toBeTruthy();
    expect(screen.getByLabelText('Alex Morgan')).toBeTruthy();
  });

  it('copes with the empty full_name Clutch sends for a nameless profile', () => {
    render(<Avatar name="  " />);
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByLabelText('Member')).toBeTruthy();
  });
});
