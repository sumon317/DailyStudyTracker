import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { describe, expect, it, vi } from 'vitest';
import TimePicker from './TimePicker';

const VIEWPORT_GAP = 10;
const EDGE_GAP = 20;

const openPopover = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: /Set Time|Study time/ }));
    return screen.findByRole('dialog', { name: 'Set study time' });
};

/**
 * Resolves the popover's box and the device insets the way a real layout would.
 *
 * jsdom reports no geometry and no `env()`, so both have to be supplied for the
 * position maths to be observable at all.
 */
const stubViewport = ({
    insets = { top: 0, right: 0, bottom: 0, left: 0 },
    box = { width: 256, height: 280 },
    trigger = { top: 400, bottom: 432, left: 40, right: 296 },
    viewport = { width: 1000, height: 800 },
}: {
    insets?: { top: number; right: number; bottom: number; left: number };
    box?: { width: number; height: number };
    trigger?: { top: number; bottom: number; left: number; right: number };
    viewport?: { width: number; height: number };
} = {}) => {
    const requested: string[] = [];
    const realGetComputedStyle = window.getComputedStyle.bind(window);
    const getComputedStyleSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
        const style = realGetComputedStyle(element, pseudo);
        // jsdom's CSS parser drops `env()` outright, so the probe is
        // identified structurally: it is the only hidden span in the panel.
        if (element.tagName === 'SPAN' && element.getAttribute('aria-hidden') === 'true') {
            return {
                ...style,
                getPropertyValue: (property: string) => {
                    requested.push(property);
                    const inset: Record<string, number | undefined> = {
                        'padding-top': insets.top,
                        'padding-right': insets.right,
                        'padding-bottom': insets.bottom,
                        'padding-left': insets.left,
                    };
                    const resolved = inset[property];
                    if (resolved !== undefined) {
                        return `${resolved}px`;
                    }
                    return style.getPropertyValue(property);
                },
            } as unknown as CSSStyleDeclaration;
        }
        return style;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(box.width);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(box.height);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
        top: trigger.top,
        bottom: trigger.bottom,
        left: trigger.left,
        right: trigger.right,
        width: trigger.right - trigger.left,
        height: trigger.bottom - trigger.top,
        x: trigger.left,
        y: trigger.top,
        toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: viewport.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: viewport.height });
    return { getComputedStyleSpy, requested };
};

describe('TimePicker', () => {
    it('shows a placeholder trigger when no time is set', () => {
        render(<TimePicker value="" onChange={vi.fn()} />);

        const trigger = screen.getByRole('button', { name: 'Set Time' });
        expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).not.toHaveAttribute('aria-controls');
    });

    it('echoes the current value in the trigger label', () => {
        render(<TimePicker value="14:05" onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Study time: 2:05 PM' })).toBeInTheDocument();
    });

    it('contains focus while open and advertises itself as modal', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        expect(popover).toHaveAttribute('aria-modal', 'true');
        await waitFor(() => expect(within(popover).getByRole('button', { name: 'Increase hour' })).toHaveFocus());
    });

    it('keeps Tab inside the popover, cycling in both directions', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        const last = within(popover).getByRole('button', { name: 'Set' });

        last.focus();
        await user.tab();
        expect(within(popover).getByRole('button', { name: 'Increase hour' })).toHaveFocus();

        await user.tab({ shift: true });
        expect(last).toHaveFocus();
    });

    it('steps the hour up and down, wrapping at 12', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="23:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        expect(within(popover).getByLabelText('Hour 11')).toBeInTheDocument();

        await user.click(within(popover).getByRole('button', { name: 'Increase hour' }));
        expect(within(popover).getByLabelText('Hour 12')).toBeInTheDocument();
        await user.click(within(popover).getByRole('button', { name: 'Increase hour' }));
        expect(within(popover).getByLabelText('Hour 1')).toBeInTheDocument();
        await user.click(within(popover).getByRole('button', { name: 'Decrease hour' }));
        await user.click(within(popover).getByRole('button', { name: 'Decrease hour' }));
        expect(within(popover).getByLabelText('Hour 11')).toBeInTheDocument();
    });

    it('steps the minute up and down, wrapping at 59', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="10:59" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        expect(within(popover).getByLabelText('Minute 59')).toBeInTheDocument();

        await user.click(within(popover).getByRole('button', { name: 'Increase minute' }));
        expect(within(popover).getByLabelText('Minute 0')).toBeInTheDocument();
        await user.click(within(popover).getByRole('button', { name: 'Decrease minute' }));
        expect(within(popover).getByLabelText('Minute 59')).toBeInTheDocument();
    });

    it('commits a 24-hour value and closes', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<TimePicker value="09:30" onChange={onChange} />);

        const popover = await openPopover(user);
        await user.click(within(popover).getByRole('button', { name: /Change period/ }));
        expect(within(popover).getByRole('button', { name: /Change period/ })).toHaveTextContent('PM');
        await user.click(within(popover).getByRole('button', { name: 'Increase hour' }));
        await user.click(within(popover).getByRole('button', { name: 'Increase minute' }));
        await user.click(within(popover).getByRole('button', { name: 'Set' }));

        expect(onChange).toHaveBeenCalledWith('22:31');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('converts midnight and noon correctly', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<TimePicker value="00:00" onChange={onChange} />);

        const popover = await openPopover(user);
        expect(within(popover).getByRole('button', { name: /Change period/ })).toHaveTextContent('AM');
        await user.click(within(popover).getByRole('button', { name: 'Set' }));
        expect(onChange).toHaveBeenLastCalledWith('00:00');

        onChange.mockClear();
        rerender(<TimePicker value="12:30" onChange={onChange} />);
        const noonPopover = await openPopover(user);
        await user.click(within(noonPopover).getByRole('button', { name: 'Set' }));
        expect(onChange).toHaveBeenLastCalledWith('12:30');
    });

    it('clears the value and closes', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<TimePicker value="09:30" onChange={onChange} />);

        const popover = await openPopover(user);
        await user.click(within(popover).getByRole('button', { name: 'Clear' }));

        expect(onChange).toHaveBeenCalledWith('');
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('restores focus to the trigger on Escape and discards uncommitted edits', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<TimePicker value="09:30" onChange={onChange} />);

        const popover = await openPopover(user);
        await user.click(within(popover).getByRole('button', { name: 'Increase hour' }));
        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Study time: 9:30 AM' })).toHaveFocus();
    });

    it('closes without committing when clicking outside', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(
            <div>
                <button type="button">Outside</button>
                <TimePicker value="09:30" onChange={onChange} />
            </div>,
        );

        await openPopover(user);
        await user.click(screen.getByRole('button', { name: 'Outside' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(onChange).not.toHaveBeenCalled();
    });

    it('re-seeds the editors from the value each time it opens', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<TimePicker value="09:30" onChange={onChange} />);

        const first = await openPopover(user);
        await user.click(within(first).getByRole('button', { name: 'Increase hour' }));
        await user.click(within(first).getByRole('button', { name: 'Set' }));
        expect(onChange).toHaveBeenLastCalledWith('10:30');

        rerender(<TimePicker value="10:30" onChange={onChange} />);
        const second = await openPopover(user);
        expect(within(second).getByLabelText('Hour 10')).toBeInTheDocument();
    });

    it('clamps out-of-range and malformed stored values instead of rendering them', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<TimePicker value="99:99" onChange={onChange} />);
        const popover = await openPopover(user);
        // 99:99 is clamped to 23:59, i.e. 11:59 PM on a 12-hour clock.
        expect(within(popover).getByLabelText('Hour 11')).toBeInTheDocument();
        expect(within(popover).getByLabelText('Minute 59')).toBeInTheDocument();
        await user.click(within(popover).getByRole('button', { name: 'Set' }));
        expect(onChange).toHaveBeenLastCalledWith('23:59');

        onChange.mockClear();
        rerender(<TimePicker value="not-a-time" onChange={onChange} />);
        const fallback = await openPopover(user);
        // Unparseable input falls back to midnight on a 12-hour clock.
        expect(within(fallback).getByLabelText('Hour 12')).toBeInTheDocument();
        expect(within(fallback).getByLabelText('Minute 0')).toBeInTheDocument();
        expect(within(fallback).getByRole('button', { name: /Change period/ })).toHaveTextContent('AM');
    });

    it('keeps a corrupt value out of the trigger label while still allowing a fix', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="99:99" onChange={vi.fn()} />);

        // The stored value cannot be shown as it is, so the placeholder stands
        // in rather than printing "99:99" back at the user.
        expect(screen.getByRole('button', { name: 'Set Time' })).toBeInTheDocument();

        const popover = await openPopover(user);
        expect(within(popover).getByLabelText('Hour 11')).toBeInTheDocument();
    });

    it('only ever commits a real 24-hour time', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        const { rerender } = render(<TimePicker value="12:59" onChange={onChange} />);

        // Noon on the 12-hour clock, the highest representable state.
        let popover = await openPopover(user);
        expect(within(popover).getByRole('button', { name: /Change period/ })).toHaveTextContent('PM');
        await user.click(within(popover).getByRole('button', { name: 'Set' }));
        expect(onChange).toHaveBeenLastCalledWith('12:59');

        // The first increment of the hour past 12 must roll into the next
        // period, never produce "24:00" or a bare "13:00".
        for (const [value, expected] of [
            ['12:59', '13:00'],
            ['11:59', '00:00'],
            ['23:59', '12:00'],
        ] as const) {
            onChange.mockClear();
            rerender(<TimePicker value={value} onChange={onChange} />);
            popover = await openPopover(user);
            await user.click(within(popover).getByRole('button', { name: 'Increase hour' }));
            await user.click(within(popover).getByRole('button', { name: 'Increase minute' }));
            await user.click(within(popover).getByRole('button', { name: 'Set' }));
            expect(onChange, `${value} + 1h1m`).toHaveBeenLastCalledWith(expected);
        }
    });

    it('announces each step through a polite live region', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        // Scoped to the <p> on purpose: <output> also maps to the `status` role,
        // so a plain role query is ambiguous inside this popover.
        const status = popover.querySelector('p[role="status"]') as HTMLElement;
        expect(status).toHaveAttribute('aria-live', 'polite');
        expect(status).toHaveAttribute('aria-atomic', 'true');
        expect(status).toHaveTextContent('9:30 AM');

        // The steppers change the time without moving focus, so the new value
        // has to be announced explicitly or it is simply lost.
        await user.click(within(popover).getByRole('button', { name: 'Increase hour' }));
        expect(status).toHaveTextContent('10:30 AM');
        await user.click(within(popover).getByRole('button', { name: 'Increase minute' }));
        expect(status).toHaveTextContent('10:31 AM');
        await user.click(within(popover).getByRole('button', { name: /Change period/ }));
        expect(status).toHaveTextContent('10:31 PM');
    });

    it('announces each step through exactly one live region, not two', async () => {
        const user = userEvent.setup();
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        // `output` is a subclass of `status`, so each readout is a polite live
        // region in its own right. Left alone they announce on top of the
        // deliberate announcement below, so every stepper press is read twice.
        const hour = within(popover).getByLabelText('Hour 9');
        const minute = within(popover).getByLabelText('Minute 30');
        expect(hour.tagName).toBe('OUTPUT');
        expect(hour).toHaveAttribute('aria-live', 'off');
        expect(minute).toHaveAttribute('aria-live', 'off');

        // The readouts stay readable to a screen reader on demand, they just
        // stop speaking over the one region that narrates the change.
        expect(hour).toHaveTextContent('9');
        expect(minute).toHaveTextContent('30');
    });

    it('keeps the panel inside the safe area reported by the device', async () => {
        const user = userEvent.setup();
        // A notched handset: 47px at the top, 34px at the bottom.
        stubViewport({ insets: { top: 47, right: 0, bottom: 34, left: 0 } });
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);

        // The trigger sits at 400-432, so below it is 440 and the box is 280
        // tall: it fits above the bottom inset but not below the trigger.
        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));
        const top = Number.parseFloat(popover.style.top);
        expect(Number.isFinite(top)).toBe(true);
        expect(top).toBeGreaterThanOrEqual(47 + EDGE_GAP);
        expect(top + 280).toBeLessThanOrEqual(800 - 34 - EDGE_GAP);
    });

    it('reads the insets from a real CSS length, not off the env() token', async () => {
        const user = userEvent.setup();
        // `env()` is only substituted for a real property, so reading the inset
        // off a custom property would hand back the literal token, parse as
        // NaN, and silently position the panel with a zero inset.
        const { requested } = stubViewport({ insets: { top: 0, right: 0, bottom: 120, left: 0 } });
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);

        // The probe is a real element inside the panel, and each inset is asked
        // for as a length.
        expect(popover.querySelector('span[aria-hidden="true"]')).not.toBeNull();
        expect(requested).toEqual(
            expect.arrayContaining(['padding-top', 'padding-right', 'padding-bottom', 'padding-left']),
        );

        // With a 120px bottom inset the box no longer fits under the trigger
        // and has to flip above it, which only happens if the inset was read.
        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));
        expect(Number.parseFloat(popover.style.top)).toBe(400 - 280 - 8);
    });

    it('ignores an inset the platform leaves unresolved', async () => {
        const user = userEvent.setup();
        // No stub: jsdom reports `env(safe-area-inset-top, 0px)` verbatim, which
        // must degrade to a zero inset rather than NaN coordinates.
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);

        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));
        expect(Number.isNaN(Number.parseFloat(popover.style.top))).toBe(false);
        expect(Number.isNaN(Number.parseFloat(popover.style.left))).toBe(false);
    });

    it('centres a box that is wider than the viewport instead of pushing it off screen', async () => {
        const user = userEvent.setup();
        stubViewport({
            viewport: { width: 240, height: 800 },
            trigger: { top: 400, bottom: 432, left: 0, right: 240 },
        });
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);

        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));
        expect(Number.parseFloat(popover.style.left)).toBe(0);
    });

    it('stays inside the horizontal safe area on a narrow viewport', async () => {
        const user = userEvent.setup();
        stubViewport({
            viewport: { width: 360, height: 800 },
            insets: { top: 0, right: 20, bottom: 0, left: 20 },
            trigger: { top: 100, bottom: 132, left: 10, right: 250 },
        });
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);

        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));
        const left = Number.parseFloat(popover.style.left);
        expect(left).toBeGreaterThanOrEqual(20 + VIEWPORT_GAP);
        expect(left + 256).toBeLessThanOrEqual(360 - 20 - VIEWPORT_GAP);
    });

    it('repositions on resize and scroll while it is open', async () => {
        const user = userEvent.setup();
        stubViewport();
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));
        const before = popover.style.top;

        act(() => {
            window.dispatchEvent(new Event('resize'));
        });

        expect(popover.style.top).toBe(before);
    });

    it('does not re-render for a scroll that does not move the panel', async () => {
        const user = userEvent.setup();
        // A fixed-position popover whose trigger has not moved is already in
        // the right place, so a scroll has nothing to reposition. A page scroll
        // fires dozens of events a second, and re-rendering the whole portalled
        // panel for each one is pure waste.
        stubViewport();
        let commits = 0;
        const onRender: ProfilerOnRenderCallback = () => {
            commits += 1;
        };
        render(
            <Profiler id="time-picker" onRender={onRender}>
                <TimePicker value="09:30" onChange={vi.fn()} />
            </Profiler>,
        );

        const popover = await openPopover(user);
        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));

        // Warm-up: the animation library does one-time geometry work the first
        // time it sees a scroll, and that is paid off here rather than counted
        // as the panel's own cost. Each event gets its own `act` so it is its
        // own commit rather than one batch of twenty.
        for (let tick = 0; tick < 3; tick += 1) {
            await act(async () => {
                window.dispatchEvent(new Event('scroll'));
            });
        }
        const settled = commits;

        for (let tick = 0; tick < 20; tick += 1) {
            await act(async () => {
                window.dispatchEvent(new Event('scroll'));
            });
        }

        expect(commits).toBe(settled);
    });

    it('still follows a scroll that does move the panel', async () => {
        const user = userEvent.setup();
        let triggerTop = 400;
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
            () =>
                ({
                    top: triggerTop,
                    bottom: triggerTop + 32,
                    left: 40,
                    right: 296,
                    width: 256,
                    height: 32,
                    x: 40,
                    y: triggerTop,
                    toJSON: () => ({}),
                }) as DOMRect,
        );
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(256);
        vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(280);
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1000 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 800 });
        render(<TimePicker value="09:30" onChange={vi.fn()} />);

        const popover = await openPopover(user);
        await waitFor(() => expect(popover).toHaveStyle({ visibility: 'visible' }));
        const before = Number.parseFloat(popover.style.top);

        triggerTop = 200;
        act(() => {
            window.dispatchEvent(new Event('scroll'));
        });

        // The trigger moved up, so the panel has to move with it.
        expect(Number.parseFloat(popover.style.top)).not.toBe(before);
    });

    it('does not restore focus when an outside press closes it', async () => {
        const user = userEvent.setup();
        render(
            <div>
                <TimePicker value="09:30" onChange={vi.fn()} />
                <button type="button">Outside</button>
            </div>,
        );

        await openPopover(user);
        await user.click(screen.getByRole('button', { name: 'Outside' }));

        // Focus belongs wherever the user just put it; yanking it back to the
        // trigger would fight the control they pressed.
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: 'Outside' })).toHaveFocus();
    });
});
