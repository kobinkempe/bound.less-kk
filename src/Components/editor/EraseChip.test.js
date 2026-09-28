/**
 * EraseChip.test.js — "Finishing the erase…" beside the title only once a gesture has waited on its
 * erase barrier for ERASE_CHIP_MS, and gone when it ends (A2 §4.11).
 */
import React from "react";
import { render, act } from "@testing-library/react";
import { EraseChip, ERASE_CHIP_MS } from "./EraseChip";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("shown after the wait has lasted ERASE_CHIP_MS, gone when it ends; a short wait shows nothing", () => {
    const { container, rerender } = render(<EraseChip erase={{ marks: 1, finishing: true }} />);
    expect(container.textContent).toBe("");
    act(() => { jest.advanceTimersByTime(ERASE_CHIP_MS - 10); });
    expect(container.textContent).toBe("");
    act(() => { jest.advanceTimersByTime(20); });
    expect(container.textContent).toBe("Finishing the erase…");
    rerender(<EraseChip erase={{ marks: 1, finishing: false }} />);
    expect(container.textContent).toBe("");
    rerender(<EraseChip erase={{ marks: 1, finishing: true }} />);
    act(() => { jest.advanceTimersByTime(ERASE_CHIP_MS / 2); });
    rerender(<EraseChip erase={{ marks: 0, finishing: false }} />);          // the cuts landed first
    act(() => { jest.advanceTimersByTime(ERASE_CHIP_MS); });
    expect(container.textContent).toBe("");
    rerender(<EraseChip erase={undefined} />);
    expect(container.textContent).toBe("");
});
