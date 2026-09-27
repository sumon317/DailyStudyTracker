import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Skeleton, { SkeletonCard } from './SkeletonLoader';

const placeholders = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>('[aria-hidden="true"]'));

describe('Skeleton', () => {
    it('hides the placeholder from assistive technology', () => {
        const { container } = render(<Skeleton className="h-4 w-full" />);
        const box = container.firstElementChild as HTMLElement;

        // A loading box carries no information, so a screen reader must not
        // announce it or let it become a stop in the tab order.
        expect(box).toHaveAttribute('aria-hidden', 'true');
        expect(box).toHaveClass('animate-pulse');
    });

    it('applies the shared pulse styles plus the caller sizing', () => {
        const { container } = render(<Skeleton className="h-4 w-full" />);
        const box = container.firstElementChild as HTMLElement;

        expect(box.className).toContain('animate-pulse');
        expect(box.className).toContain('rounded-md');
        expect(box.className).toContain('h-4');
        expect(box.className).toContain('w-full');
    });

    it('renders with no class of its own rather than an undefined placeholder', () => {
        const { container } = render(<Skeleton />);
        const box = container.firstElementChild as HTMLElement;

        expect(box.className.trim().split(/\s+/)).toEqual(['animate-pulse', 'rounded-md', 'bg-app-border/60']);
    });

    it('merges an inline style and still keeps the caller class', () => {
        const { container } = render(<Skeleton className="h-8" style={{ width: '3rem' }} />);
        const box = container.firstElementChild as HTMLElement;

        expect(box).toHaveClass('h-8');
        expect(box.style.width).toBe('3rem');
    });

    it('hides decorative children rather than leaving them readable', () => {
        const { container } = render(
            <Skeleton>
                <span>placeholder text</span>
            </Skeleton>,
        );
        const box = container.firstElementChild as HTMLElement;

        expect(box).toHaveAttribute('aria-hidden', 'true');
        expect(box).toHaveTextContent('placeholder text');
    });
});

describe('SkeletonCard', () => {
    it('renders a single card by default', () => {
        const { container } = render(<SkeletonCard />);
        const cards = container.firstElementChild?.children ?? [];

        expect(cards).toHaveLength(1);
    });

    it('renders the requested number of cards', () => {
        const { container } = render(<SkeletonCard count={3} />);

        expect(container.firstElementChild?.children).toHaveLength(3);
    });

    it('renders nothing for a non-positive count instead of throwing', () => {
        for (const count of [0, -1, Number.NaN]) {
            const { container } = render(<SkeletonCard count={count} />);
            expect(container.firstElementChild?.children, `count=${count}`).toHaveLength(0);
        }
    });

    it('hides the whole card group from assistive technology', () => {
        const { container } = render(<SkeletonCard count={2} />);
        const wrapper = container.firstElementChild as HTMLElement;

        // Every card and every bar inside it is decorative.
        expect(wrapper).toHaveAttribute('aria-hidden', 'true');
        expect(placeholders(wrapper)).toHaveLength(2 * 5);
    });

    it('gives each card the same shape: icon, title and three lines of body', () => {
        const { container } = render(<SkeletonCard />);
        const card = (container.firstElementChild?.children[0] ?? null) as HTMLElement;
        const bars = placeholders(card);

        // Five bars per card: a round icon, a title beside it, then three
        // tapering lines of body copy.
        expect(bars).toHaveLength(5);
        expect(bars[0]).toHaveClass('rounded-full');
        expect(card).toHaveClass('rounded-xl');
        expect(card).toHaveClass('border-app-border');
    });

    it('drops the trailing margin on the last card only', () => {
        const { container } = render(<SkeletonCard count={3} />);
        const cards = Array.from(container.firstElementChild?.children ?? []) as HTMLElement[];

        expect(cards).toHaveLength(3);
        expect(cards[0]?.className).toContain('mb-4');
        expect(cards[1]?.className).toContain('mb-4');
        // `last:mb-0` is what keeps the last card flush with the panel.
        expect(cards[2]?.className).toContain('last:mb-0');
    });
});
