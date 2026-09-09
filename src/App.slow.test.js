import { render, screen } from '@testing-library/react';
import App from './App';

// Smoke test: the app renders and the home screen offers the canvas
// (the "Start creating" button routes to the gallery, then the editor).
//
// It mounts the WHOLE app — the router, the pages, Two.js and the engine
// module graph — in jsdom, which is why it is a *.slow.test.js: it was the
// single most expensive test in the suite at 195 s when roadmap E2 was
// written (2026-08-28). Measured alone on 2026-09-07: 26 s of test time, 43 s
// of wall clock including jest's start-up, on the development machine. That
// is the cost of importing the module graph once, and it is accepted as the
// price of the one test that proves the app boots; nothing is mocked so that
// a broken import anywhere in src/ fails it.
test('renders the home screen with a way into the canvas', () => {
  render(<App />);
  expect(screen.getByText(/start creating/i)).toBeInTheDocument();
});
