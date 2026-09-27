import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import type { RefObject } from 'react';
import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TempTime, TimePickerProps } from '../../types';
import { formatTimeValue, parseTimeValue } from '../../utils/timeUtils';
import { getFocusableElements } from './focusOrder';

const VIEWPORT_GAP = 10;
const EDGE_GAP = 20;
const NARROW_VIEWPORT = 500;
// Fallbacks for the popover box, used until it has been measured (and forever
// in environments that report no layout, such as jsdom).
const FALLBACK_WIDTH = 256;
const FALLBACK_HEIGHT = 280;

type SafeSide = 'top' | 'right' | 'bottom' | 'left';

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

/**
 * A zero-size probe that resolves the device's safe-area insets into real
 * lengths.
 *
 * `env()` is only substituted for an actual CSS property, so the insets cannot
 * be read back off a plain `--popover-safe-*` custom property: the computed
 * value of an unregistered custom property is the literal `env(...)` token
 * stream, which every numeric parse turns into NaN, i.e. a zero inset. Handing
 * the same `env()` to a padding puts real pixels in front of the position
 * maths, and the probe itself is invisible and takes up no space.
 *
 * The ref is passed in rather than shared so a second picker cannot leave the
 * first one reading from a probe that is no longer mounted.
 */
const SafeAreaProbe = ({ probeRef }: { probeRef: RefObject<HTMLSpanElement> }) => (
    <span
        ref={probeRef}
        aria-hidden="true"
        style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 0,
            height: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
            paddingTop: 'env(safe-area-inset-top, 0px)',
            paddingRight: 'env(safe-area-inset-right, 0px)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            paddingLeft: 'env(safe-area-inset-left, 0px)',
        }}
    />
);

const readInset = (element: HTMLElement, side: SafeSide): number => {
    const raw = window.getComputedStyle(element).getPropertyValue(`padding-${side}`).trim();
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : 0;
};

const TimePicker = memo(({ value, onChange }: TimePickerProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [tempTime, setTempTime] = useState<TempTime>(() => parseTimeValue(value));
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const safeAreaProbeRef = useRef<HTMLSpanElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const titleId = useId();
    const triggerId = useId();
    const dialogId = useId();

    const closePopup = useCallback(() => {
        setIsOpen(false);
        triggerRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!isOpen) {
            setTempTime(parseTimeValue(value));
        }
    }, [isOpen, value]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const focusTimer = window.setTimeout(() => {
            getFocusableElements(popupRef.current ?? document)[0]?.focus();
        }, 0);

        const handleOutside = (event: Event) => {
            const target = event.target as Node | null;
            if (target && !containerRef.current?.contains(target) && !popupRef.current?.contains(target)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePopup();
                return;
            }
            if (event.key !== 'Tab' || !popupRef.current) {
                return;
            }

            const focusable = getFocusableElements(popupRef.current);
            if (focusable.length === 0) {
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };

        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('touchstart', handleOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.clearTimeout(focusTimer);
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('touchstart', handleOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [closePopup, isOpen]);

    /**
     * Positions the portalled popover against the viewport.
     *
     * The box is measured rather than assumed so a longer translation or a
     * larger font cannot push it off screen, and the safe-area insets are read
     * back from the popover's own custom properties so a notched device is not
     * covered by the panel. Focus is deliberately *not* restored on unmount:
     * closing by an outside press has to leave focus where the user put it.
     */
    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const updatePosition = () => {
            const trigger = containerRef.current;
            const popup = popupRef.current;
            if (!trigger) {
                return;
            }
            const rect = trigger.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const screenHeight = window.innerHeight;
            const popoverWidth = popup?.offsetWidth || FALLBACK_WIDTH;
            const popoverHeight = popup?.offsetHeight || FALLBACK_HEIGHT;
            const probe = safeAreaProbeRef.current;
            const safeTop = probe ? readInset(probe, 'top') : 0;
            const safeRight = probe ? readInset(probe, 'right') : 0;
            const safeBottom = probe ? readInset(probe, 'bottom') : 0;
            const safeLeft = probe ? readInset(probe, 'left') : 0;

            const minLeft = safeLeft + VIEWPORT_GAP;
            const maxLeft = screenWidth - popoverWidth - safeRight - VIEWPORT_GAP;
            const preferredLeft =
                screenWidth < NARROW_VIEWPORT ? (screenWidth - popoverWidth) / 2 : rect.right - popoverWidth;
            // A viewport narrower than the popover gets a centred, clipped box
            // rather than a negative offset that would push content off screen.
            const left =
                maxLeft < minLeft
                    ? Math.max(0, (screenWidth - popoverWidth) / 2)
                    : clamp(preferredLeft, minLeft, maxLeft);

            const below = rect.bottom + 8;
            const above = rect.top - popoverHeight - 8;
            const maxTop = screenHeight - popoverHeight - safeBottom - EDGE_GAP;
            const minTop = safeTop + EDGE_GAP;
            let top = below;
            if (top > maxTop) {
                top = above;
            }
            if (top < minTop) {
                top = clamp(maxTop, minTop, Math.max(minTop, (screenHeight - popoverHeight) / 2));
            }
            // A page scroll fires this dozens of times a second and the panel is
            // `position: fixed`, so most of those scrolls do not move it at all.
            // Handing back the previous object when nothing changed is what
            // keeps the whole portalled panel from re-rendering per event.
            setPosition((previous) => (previous?.top === top && previous.left === left ? previous : { top, left }));
        };

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [isOpen]);

    const handleSave = useCallback(() => {
        const { h, m, period } = tempTime;
        let hours24 = h;
        if (period === 'PM' && h !== 12) {
            hours24 += 12;
        }
        if (period === 'AM' && h === 12) {
            hours24 = 0;
        }
        onChange(`${String(hours24).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
        closePopup();
    }, [closePopup, onChange, tempTime]);

    const handleClear = useCallback(() => {
        onChange('');
        closePopup();
    }, [closePopup, onChange]);

    const adjust = useCallback((field: 'h' | 'm', amount: number) => {
        setTempTime((previous) => {
            let next = previous[field] + amount;
            if (field === 'h') {
                next = next > 12 ? 1 : next < 1 ? 12 : next;
            } else {
                next = next > 59 ? 0 : next < 0 ? 59 : next;
            }
            return { ...previous, [field]: next };
        });
    }, []);

    const togglePeriod = useCallback(() => {
        setTempTime((previous) => ({ ...previous, period: previous.period === 'AM' ? 'PM' : 'AM' }));
    }, []);

    const displayValue = formatTimeValue(value);
    const announcement = `${tempTime.h}:${String(tempTime.m).padStart(2, '0')} ${tempTime.period}`;
    const popupContent = (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    ref={popupRef}
                    id={dialogId}
                    role="dialog"
                    // Focus is deliberately contained while the popover is open,
                    // so the dialog advertises itself as modal rather than
                    // leaving the page behind reachable-but-invisible.
                    aria-modal="true"
                    aria-labelledby={titleId}
                    tabIndex={-1}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.1 }}
                    style={{
                        position: 'fixed',
                        top: position?.top ?? 0,
                        left: position?.left ?? 0,
                        zIndex: 9999,
                        // Hidden until measured: the first paint would otherwise
                        // flash the panel in the top left corner of the screen.
                        visibility: position ? 'visible' : 'hidden',
                    }}
                    className="w-64 rounded-xl border border-app-border bg-app-surface p-4 shadow-xl"
                >
                    <SafeAreaProbe probeRef={safeAreaProbeRef} />
                    <h2 id={titleId} className="sr-only">
                        Set study time
                    </h2>
                    {/* The steppers change the time without moving focus, so the
                        new value has to be announced explicitly. */}
                    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                        {announcement}
                    </p>
                    <div className="mb-6 flex items-center justify-center gap-2">
                        <div className="flex flex-col items-center">
                            <button
                                type="button"
                                onClick={() => adjust('h', 1)}
                                className="rounded p-1 text-app-text-muted transition-colors hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-app-primary"
                                aria-label="Increase hour"
                            >
                                <ChevronUp size={20} aria-hidden="true" />
                            </button>
                            <output
                                className="w-16 select-none text-center font-mono text-3xl font-bold text-app-text-main"
                                aria-label={`Hour ${tempTime.h}`}
                                // `output` is a subclass of `status`, so it is a
                                // polite live region by default and would speak
                                // over the announcement below. The readout stays
                                // readable on demand; it just does not announce
                                // itself a second time.
                                aria-live="off"
                            >
                                {tempTime.h}
                            </output>
                            <button
                                type="button"
                                onClick={() => adjust('h', -1)}
                                className="rounded p-1 text-app-text-muted transition-colors hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-app-primary"
                                aria-label="Decrease hour"
                            >
                                <ChevronDown size={20} aria-hidden="true" />
                            </button>
                            <span
                                className="text-[10px] font-bold tracking-wide text-app-text-muted"
                                aria-hidden="true"
                            >
                                HR
                            </span>
                        </div>

                        <div className="mb-4 text-2xl font-bold text-app-text-muted" aria-hidden="true">
                            :
                        </div>

                        <div className="flex flex-col items-center">
                            <button
                                type="button"
                                onClick={() => adjust('m', 1)}
                                className="rounded p-1 text-app-text-muted transition-colors hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-app-primary"
                                aria-label="Increase minute"
                            >
                                <ChevronUp size={20} aria-hidden="true" />
                            </button>
                            <output
                                className="w-16 select-none text-center font-mono text-3xl font-bold text-app-text-main"
                                aria-label={`Minute ${tempTime.m}`}
                                aria-live="off"
                            >
                                {tempTime.m.toString().padStart(2, '0')}
                            </output>
                            <button
                                type="button"
                                onClick={() => adjust('m', -1)}
                                className="rounded p-1 text-app-text-muted transition-colors hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-app-primary"
                                aria-label="Decrease minute"
                            >
                                <ChevronDown size={20} aria-hidden="true" />
                            </button>
                            <span
                                className="text-[10px] font-bold tracking-wide text-app-text-muted"
                                aria-hidden="true"
                            >
                                MIN
                            </span>
                        </div>

                        <div className="ml-2 flex flex-col items-center">
                            <button
                                type="button"
                                onClick={togglePeriod}
                                className={`rounded-lg border px-2 py-4 text-sm font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-app-primary ${
                                    tempTime.period === 'AM'
                                        ? 'border-app-warning-container bg-app-warning-container text-app-warning-container-text'
                                        : 'border-app-primary-container bg-app-primary-container text-app-primary-container-text'
                                }`}
                                aria-label={`Change period. Current period ${tempTime.period}`}
                                aria-pressed={tempTime.period === 'PM'}
                            >
                                {tempTime.period}
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleClear}
                            className="flex-1 rounded-lg border border-app-border py-2 text-xs font-medium text-app-text-muted transition-colors hover:bg-app-bg focus:outline-none focus:ring-2 focus:ring-app-primary"
                        >
                            Clear
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-app-primary py-2 text-xs font-bold text-app-primary-fg shadow-sm transition-colors hover:bg-app-primary-hover focus:outline-none focus:ring-2 focus:ring-app-primary"
                        >
                            <Check size={14} aria-hidden="true" /> Set
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return (
        <div className="relative" ref={containerRef}>
            <button
                ref={triggerRef}
                id={triggerId}
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                className={`flex w-full min-w-[110px] items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all focus:outline-none focus:ring-2 focus:ring-app-primary sm:text-sm ${
                    value
                        ? 'border-app-primary bg-app-primary/10 text-app-primary'
                        : 'border-app-border bg-app-surface text-app-text-muted hover:border-app-primary/50'
                }`}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-controls={isOpen ? dialogId : undefined}
                aria-label={displayValue ? `Study time: ${displayValue}` : 'Set Time'}
            >
                <Clock size={14} aria-hidden="true" />
                {displayValue || 'Set Time'}
            </button>
            {typeof document !== 'undefined' && createPortal(popupContent, document.body)}
        </div>
    );
});

TimePicker.displayName = 'TimePicker';

export default TimePicker;
