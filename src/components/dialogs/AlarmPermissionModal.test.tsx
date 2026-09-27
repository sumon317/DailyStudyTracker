import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import AlarmPermissionModal from './AlarmPermissionModal';

const Harness = ({ onOpenSettings }: { onOpenSettings?: () => void } = {}) => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button type="button" onClick={() => setOpen(true)}>
                Open permission dialog
            </button>
            <button type="button">After</button>
            <AlarmPermissionModal
                isOpen={open}
                onClose={() => setOpen(false)}
                onOpenSettings={onOpenSettings ?? (() => setOpen(false))}
            />
        </>
    );
};

describe('AlarmPermissionModal', () => {
    it('labels the dialog for both its title and its explanation', () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: /open permission dialog/i }));

        const dialog = screen.getByRole('dialog', { name: 'Alarm Permission Needed' });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        const descriptionId = dialog.getAttribute('aria-describedby');
        expect(descriptionId).toBeTruthy();
        expect(document.getElementById(descriptionId ?? '')).toHaveTextContent(/Alarms & Reminders/i);
    });

    it('moves focus into the dialog and hands it back on close', async () => {
        render(<Harness />);
        const opener = screen.getByRole('button', { name: /open permission dialog/i });
        opener.focus();
        fireEvent.click(opener);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /close alarm permission dialog/i })).toHaveFocus(),
        );

        fireEvent.keyDown(document, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(opener).toHaveFocus();
    });

    it('keeps focus inside the dialog when something moves it outside', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: /open permission dialog/i }));
        const dialog = await screen.findByRole('dialog', { name: 'Alarm Permission Needed' });

        // The page behind a blocking modal stays unreachable; only the Tab ring
        // would otherwise let focus escape if something moved it.
        const outside = screen.getByRole('button', { name: 'After' });
        outside.focus();
        fireEvent.focusIn(outside);

        expect(dialog).toHaveFocus();
    });

    it('closes from either dismissal control', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: /open permission dialog/i }));
        fireEvent.click(await screen.findByRole('button', { name: /^later$/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /open permission dialog/i }));
        fireEvent.click(await screen.findByRole('button', { name: /close alarm permission dialog/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('routes the settings action to the caller', async () => {
        const onOpenSettings = vi.fn();
        render(<Harness onOpenSettings={onOpenSettings} />);
        fireEvent.click(screen.getByRole('button', { name: /open permission dialog/i }));

        fireEvent.click(await screen.findByRole('button', { name: /open settings/i }));
        expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });

    it('leaves the opener focused when it unmounts while open', async () => {
        const openerRef = { current: null as HTMLButtonElement | null };
        const UnmountHarness = () => {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button
                        type="button"
                        ref={(element) => {
                            openerRef.current = element;
                        }}
                        onClick={() => setOpen(true)}
                    >
                        Open permission dialog
                    </button>
                    {open && <AlarmPermissionModal isOpen onClose={() => setOpen(false)} onOpenSettings={vi.fn()} />}
                </>
            );
        };
        render(<UnmountHarness />);
        const opener = screen.getByRole('button', { name: /open permission dialog/i });
        opener.focus();
        fireEvent.click(opener);
        await screen.findByRole('dialog');

        fireEvent.click(screen.getByRole('button', { name: /^later$/i }));
        await waitFor(() => expect(opener).toHaveFocus());
        expect(openerRef.current).toBe(opener);
    });

    it('does not restore focus onto a trigger that is already gone', async () => {
        const GoneHarness = () => {
            const [open, setOpen] = useState(false);
            const [triggerMounted, setTriggerMounted] = useState(true);
            return (
                <>
                    {triggerMounted && (
                        <button
                            type="button"
                            onClick={() => {
                                setTriggerMounted(false);
                                setOpen(true);
                            }}
                        >
                            Open permission dialog
                        </button>
                    )}
                    {open && <AlarmPermissionModal isOpen onClose={() => setOpen(false)} onOpenSettings={vi.fn()} />}
                </>
            );
        };
        render(<GoneHarness />);
        const trigger = screen.getByRole('button', { name: /open permission dialog/i });
        trigger.focus();
        fireEvent.click(trigger);
        await screen.findByRole('dialog');

        // Focusing the detached trigger would be a silent no-op, and the caret would
        // end up on `<body` with the tab sequence restarting from the top.
        fireEvent.click(screen.getByRole('button', { name: /^later$/i }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(document.body).toHaveFocus();
    });
});
