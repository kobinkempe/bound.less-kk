import { render, screen } from '@testing-library/react';
import App from './App';

// Smoke test: the app renders and the home screen offers the canvas
// (the "Start creating" button routes to the gallery, then the editor).
test('renders the home screen with a way into the canvas', () => {
  render(<App />);
  expect(screen.getByText(/start creating/i)).toBeInTheDocument();
});
