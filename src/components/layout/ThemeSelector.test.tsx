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

    it('uses the provider picker, persists the canonical color, and applies the adaptive theme', async () => {
        const user = userEvent.setup();
        renderSelector();

        await user.click(screen.getByRole('button', { name: /change theme/i }));
        await user.click(screen.getByRole('menuitemradio', { name: /adaptive/i }));

        await waitFor(() => expect(localStorage.getItem('adaptive-color')).toBe('#ff0000'));
        expect(document.documentElement.classList.contains('theme-adaptive')).toBe(true);
        expect(document.documentElement.style.getPropertyValue('--color-app-primary')).not.toBe('');
    });

    it('does not switch or persist a color when the picker is cancelled', async () => {
        const user = userEvent.setup();
        Object.defineProperty(window, 'EyeDropper', {
            configurable: true,
            value: class {
                open = async () => {
                    throw new DOMException('User cancelled', 'AbortError');
                };
            },
        });

        renderSelector();

        await user.click(screen.getByRole('button', { name: /change theme/i }));
        await user.click(screen.getByRole('menuitemradio', { name: /adaptive/i }));

        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        expect(document.documentElement.classList.contains('theme-adaptive')).toBe(false);
        expect(localStorage.getItem('adaptive-color')).toBeNull();
    });

    it('explains that colour picking is unavailable instead of closing silently', async () => {
        const user = userEvent.setup();
        // Deleting the API is what a browser without EyeDropper actually looks like.
        Reflect.deleteProperty(window, 'EyeDropper');

        renderSelector();
        await user.click(screen.getByRole('button', { name: /change theme/i }));
        await user.click(screen.getByRole('menuitemradio', { name: /adaptive/i }));

        expect(
            await screen.findByText('Colour picking is not supported in this browser. Pick another theme.'),
        ).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/not supported in this browser/);
    });

    it('reports a cancelled pick without claiming the browser lacks support', async () => {
        const user = userEvent.setup();
        Object.defineProperty(window, 'EyeDropper', {
            configurable: true,
            value: class {
                open = async () => {
                    throw new DOMException('User cancelled', 'AbortError');
                };
            },
        });

        renderSelector();
        await user.click(screen.getByRole('button', { name: /change theme/i }));
        await user.click(screen.getByRole('menuitemradio', { name: /adaptive/i }));

        expect(await screen.findByText('No colour was picked. Your theme is unchanged.')).toBeInTheDocument();
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
        await waitFor(() => expect(within(menu).getByRole('menuitemradio', { name: /Light/ })).toHaveFocus());
    });

    it('marks exactly the active theme as checked', async () => {
        const user = userEvent.setup();
        localStorage.setItem('theme', 'dark');
        renderSelector();

        const menu = await openMenu(user);
        expect(within(menu).getByRole('menuitemradio', { name: /^Dark/ })).toHaveAttribute('aria-checked', 'true');
        expect(within(menu).getByRole('menuitemradio', { name: /^Light/ })).toHaveAttribute('aria-checked', 'false');
    });

    it('persists a directly chosen theme and closes the menu', async () => {
        const user = userEvent.setup();
        renderSelector();

        const menu = await openMenu(user);
        await user.click(within(menu).getByRole('menuitemradio', { name: /Material Dark/ }));

        await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
        expect(localStorage.getItem('theme')).toBe('material-dark');
        expect(document.documentElement.classList.contains('theme-material-dark')).toBe(true);
        expect(screen.getByRole('button', { name: /Current theme: Material Dark/ })).toBeInTheDocument();
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
