import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import ThemeProvider, { useTheme } from '../../providers/ThemeProvider';
import ThemeSelector from './ThemeSelector';

function Harness() {
    const { theme, setTheme } = useTheme();
    return (
        <>
            <ThemeSelector theme={theme} setTheme={setTheme} />
            <button type="button">After</button>
        </>
    );
}

const renderSelector = () =>
    render(
        <ThemeProvider>
            <Harness />
        </ThemeProvider>,
    );

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    const trigger = screen.getByRole('button', { name: /change theme/i });
    await user.click(trigger);
    return screen.findByRole('menu', { name: 'Theme options' });
};

describe('ThemeSelector', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.className = '';
        document.documentElement.removeAttribute('style');
    });

    it('exposes a labelled menu and moves focus to the first option', async () => {
        const user = userEvent.setup();
        renderSelector();

        const trigger = screen.getByRole('button', { name: /change theme/i });
        expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(trigger).not.toHaveAttribute('aria-controls');

        const menu = await openMenu(user);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(trigger).toHaveAttribute('aria-controls', menu.id);
        await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: /Midnight/ })).toHaveFocus());
    });

    it('marks exactly the active theme as checked', async () => {
        const user = userEvent.setup();
        localStorage.setItem('theme', 'nord');
        renderSelector();

        const menu = await openMenu(user);
        expect(within(menu).getByRole('menuitemradio', { name: /^Nord/ })).toHaveAttribute('aria-checked', 'true');
        expect(within(menu).getByRole('menuitemradio', { name: /^Midnight/ })).toHaveAttribute('aria-checked', 'false');
        expect(within(menu).getByRole('menuitemradio', { name: /^Daylight/ })).toHaveAttribute('aria-checked', 'false');
        expect(within(menu).getByRole('menuitemradio', { name: /^Ink/ })).toHaveAttribute('aria-checked', 'false');
        expect(within(menu).getByRole('menuitemradio', { name: /^Sepia/ })).toHaveAttribute('aria-checked', 'false');
        expect(within(menu).getByRole('menuitemradio', { name: /^Rose/ })).toHaveAttribute('aria-checked', 'false');
    });

    it('persists a directly chosen theme and closes the menu', async () => {
        const user = userEvent.setup();
        renderSelector();

        const menu = await openMenu(user);
        await user.click(within(menu).getByRole('menuitemradio', { name: /^Sepia/ }));

        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        expect(localStorage.getItem('theme')).toBe('sepia');
        expect(document.documentElement.classList.contains('theme-sepia')).toBe(true);
        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(screen.getByRole('button', { name: /Current theme: Sepia/ })).toBeInTheDocument();
    });

    it('closes on Escape and restores focus to the trigger', async () => {
        const user = userEvent.setup();
        renderSelector();

        const trigger = screen.getByRole('button', { name: /change theme/i });
        await user.click(trigger);
        await waitFor(() => expect(screen.getByRole('menu', { name: 'Theme options' })).toBeInTheDocument());

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        expect(trigger).toHaveFocus();
    });

    it('closes on Tab and hands focus to the next control outside the menu', async () => {
        const user = userEvent.setup();
        renderSelector();

        const trigger = screen.getByRole('button', { name: /change theme/i });
        await user.click(trigger);
        await waitFor(() => expect(screen.getByRole('menu', { name: 'Theme options' })).toBeInTheDocument());

        await user.tab();

        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        expect(trigger).not.toHaveFocus();
    });

    it('closes when clicking outside', async () => {
        const user = userEvent.setup();
        render(
            <ThemeProvider>
                <Harness />
                <button type="button">Outside</button>
            </ThemeProvider>,
        );

        await user.click(screen.getByRole('button', { name: /change theme/i }));
        await waitFor(() => expect(screen.getByRole('menu', { name: 'Theme options' })).toBeInTheDocument());

        await user.click(screen.getByRole('button', { name: 'Outside' }));

        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    });

    it('toggles shut when the trigger is pressed again', async () => {
        const user = userEvent.setup();
        renderSelector();

        const trigger = screen.getByRole('button', { name: /change theme/i });
        await user.click(trigger);
        await waitFor(() => expect(screen.getByRole('menu', { name: 'Theme options' })).toBeInTheDocument());

        await user.click(trigger);

        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
});
