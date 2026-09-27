import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    downloadAndInstallUpdate: vi.fn(),
    native: true,
    checkInstallPermission: vi.fn(),
    openInstallPermissionSettings: vi.fn(),
    browserOpen: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn((name: string) => ({ __plugin: name })),
    Capacitor: {
        isNativePlatform: () => mocks.native,
        getPlatform: () => (mocks.native ? 'android' : 'web'),
    },
}));

vi.mock('@capacitor/browser', () => ({
    Browser: {
        open: mocks.browserOpen,
    },
}));

vi.mock('../../native/NativeAppUpdate', async () => {
    const actual = await vi.importActual<typeof import('../../native/NativeAppUpdate')>('../../native/NativeAppUpdate');
    return {
        ...actual,
        default: {
            checkInstallPermission: mocks.checkInstallPermission,
            openInstallPermissionSettings: mocks.openInstallPermissionSettings,
            installApk: vi.fn(),
        },
    };
});

vi.mock('../../services/updateService', async () => {
    const actual = await vi.importActual<typeof import('../../services/updateService')>('../../services/updateService');
    return { ...actual, downloadAndInstallUpdate: mocks.downloadAndInstallUpdate };
});

import UpdateModal from './UpdateModal';

const update = {
    available: true,
    tag: 'v9.0.0',
    url: 'https://github.com/sumon317/DailyStudyTracker/releases/download/v9.0.0/app.apk',
    notes: 'Release notes',
    assetName: 'app.apk',
    sha256: 'a'.repeat(64),
    size: 1024,
};

describe('UpdateModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.native = true;
        mocks.checkInstallPermission.mockResolvedValue({ granted: true });
        mocks.openInstallPermissionSettings.mockResolvedValue(undefined);
        mocks.browserOpen.mockResolvedValue(undefined);
    });

    it('shows installing while the awaited operation is pending and then success', async () => {
        let resolveInstall: ((value: { success: boolean }) => void) | undefined;
        mocks.downloadAndInstallUpdate.mockImplementation(
            (_source: unknown, options: { onProgress: (value: number) => void; onPhase: (phase: string) => void }) => {
                options.onProgress(40);
                options.onPhase('installing');
                return new Promise<{ success: boolean }>((resolve) => {
                    resolveInstall = resolve;
                });
            },
        );
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText(/installing/i)).toBeInTheDocument();

        resolveInstall?.({ success: true });
        await waitFor(() => expect(screen.getByText(/handed to the Android package installer/i)).toBeInTheDocument());
        expect(screen.queryByText(/installing/i)).not.toBeInTheDocument();
    });

    it('shows an error and leaves installing state when installation fails', async () => {
        mocks.downloadAndInstallUpdate.mockResolvedValue({ success: false, error: 'Install failed' });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText('Install failed')).toBeInTheDocument();
        expect(screen.queryByText(/installing/i)).not.toBeInTheDocument();
    });

    it('offers manual browser fallback when no digest is available', () => {
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={{ ...update, sha256: undefined }} />);
        expect(screen.getByRole('button', { name: /update now/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /manual browser installation/i })).toBeInTheDocument();
    });

    it('checks the install permission before transferring the APK', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));

        expect(await screen.findByText('Android permission to install packages is required.')).toBeInTheDocument();
        expect(mocks.downloadAndInstallUpdate).not.toHaveBeenCalled();
    });

    it('never reports a refusal behind a download progress bar that never moved', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));

        // The probe is its own phase: a 0% download bar would claim bytes are on
        // the wire when the transfer never started.
        expect(await screen.findByText('Android permission to install packages is required.')).toBeInTheDocument();
        expect(screen.queryByText(/downloading/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar', { name: /download progress/i })).not.toBeInTheDocument();
    });

    it('shows the permission probe as its own busy phase', async () => {
        let resolveProbe: ((value: { granted: boolean }) => void) | undefined;
        mocks.checkInstallPermission.mockImplementation(
            () =>
                new Promise<{ granted: boolean }>((resolve) => {
                    resolveProbe = resolve;
                }),
        );
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));

        expect(await screen.findByText(/checking install permission/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /update now/i })).toBeDisabled();
        // The probe resolving hands the dialog back to `handleUpdate`, which is
        // about to write more state. Letting that land after the test body would
        // report it as an update outside `act`.
        await act(async () => {
            resolveProbe?.({ granted: true });
            await Promise.resolve();
        });
    });

    it('reports a bridge that cannot answer the permission probe', async () => {
        mocks.checkInstallPermission.mockRejectedValue(new Error('NativeAppUpdate implementation not found'));
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));

        // The raw bridge message is not actionable for the user.
        expect(
            await screen.findByText(
                'Could not read the Android install permission. Update this app manually, then try again.',
            ),
        ).toBeInTheDocument();
        expect(screen.queryByText(/implementation not found/i)).not.toBeInTheDocument();
        expect(mocks.downloadAndInstallUpdate).not.toHaveBeenCalled();
    });

    it('treats a missing permission result as not granted', async () => {
        mocks.checkInstallPermission.mockResolvedValue(undefined);
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));

        expect(await screen.findByText('Android permission to install packages is required.')).toBeInTheDocument();
        expect(mocks.downloadAndInstallUpdate).not.toHaveBeenCalled();
    });

    it('offers a recovery action that opens the install permission settings', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        fireEvent.click(await screen.findByRole('button', { name: /grant install permission/i }));

        await waitFor(() => expect(mocks.openInstallPermissionSettings).toHaveBeenCalledTimes(1));
    });

    it('explains when the install permission settings cannot be opened', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        mocks.openInstallPermissionSettings.mockRejectedValue(new Error('no settings activity'));
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        fireEvent.click(await screen.findByRole('button', { name: /grant install permission/i }));

        expect(
            await screen.findByText('Install permission settings are unavailable on this device.'),
        ).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /grant install permission/i })).not.toBeInTheDocument();
    });

    it('installs when the install permission is already granted', async () => {
        mocks.downloadAndInstallUpdate.mockResolvedValue({ success: true });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));

        expect(await screen.findByText(/handed to the Android package installer/i)).toBeInTheDocument();
        expect(mocks.checkInstallPermission).toHaveBeenCalledTimes(1);
        expect(mocks.downloadAndInstallUpdate).toHaveBeenCalledTimes(1);
    });

    it('skips the native permission probe off Android', async () => {
        mocks.native = false;
        mocks.downloadAndInstallUpdate.mockResolvedValue({ success: true });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));

        await waitFor(() => expect(mocks.downloadAndInstallUpdate).toHaveBeenCalledTimes(1));
        expect(mocks.checkInstallPermission).not.toHaveBeenCalled();
    });

    it('ignores a second update request while one is already in flight', async () => {
        let resolveInstall: ((value: { success: boolean }) => void) | undefined;
        mocks.downloadAndInstallUpdate.mockImplementation(
            () =>
                new Promise<{ success: boolean }>((resolve) => {
                    resolveInstall = resolve;
                }),
        );
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        const updateButton = screen.getByRole('button', { name: /update now/i });
        fireEvent.click(updateButton);
        fireEvent.click(updateButton);

        await waitFor(() => expect(mocks.downloadAndInstallUpdate).toHaveBeenCalledTimes(1));
        // Inside `act`: the install resolving releases the tail of `handleUpdate`,
        // which writes the success state.
        await act(async () => {
            resolveInstall?.({ success: true });
            await Promise.resolve();
        });
    });

    it('ignores a second update request while the permission probe is still running', async () => {
        let resolveProbe: ((value: { granted: boolean }) => void) | undefined;
        mocks.checkInstallPermission.mockImplementation(
            () =>
                new Promise<{ granted: boolean }>((resolve) => {
                    resolveProbe = resolve;
                }),
        );
        mocks.downloadAndInstallUpdate.mockResolvedValue({ success: true });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        const updateButton = screen.getByRole('button', { name: /update now/i });
        fireEvent.click(updateButton);
        fireEvent.click(updateButton);

        await waitFor(() => expect(mocks.checkInstallPermission).toHaveBeenCalledTimes(1));
        // Inside `act`: the grant releases the second half of `handleUpdate`,
        // which writes state the test then asserts on.
        await act(async () => {
            resolveProbe?.({ granted: true });
            await Promise.resolve();
        });
        await waitFor(() => expect(mocks.downloadAndInstallUpdate).toHaveBeenCalledTimes(1));
    });

    it('closes on Escape while idle but not while an install is pending', async () => {
        const onClose = vi.fn();
        let resolveInstall: ((value: { success: boolean }) => void) | undefined;
        mocks.downloadAndInstallUpdate.mockImplementation(
            (_source: unknown, options: { onPhase: (phase: string) => void }) => {
                options.onPhase('installing');
                return new Promise<{ success: boolean }>((resolve) => {
                    resolveInstall = resolve;
                });
            },
        );
        render(<UpdateModal isOpen onClose={onClose} updateInfo={update} />);

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        await screen.findByText(/installing/i);
        onClose.mockClear();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();

        resolveInstall?.({ success: true });
        await waitFor(() => expect(screen.getByText(/handed to the Android package installer/i)).toBeInTheDocument());
    });

    it('traps focus inside the dialog while it claims to be modal', async () => {
        const onClose = vi.fn();
        render(<UpdateModal isOpen onClose={onClose} updateInfo={update} />);

        const dialog = screen.getByRole('dialog', { name: /update available/i });
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        const close = screen.getByRole('button', { name: /close update dialog/i });
        const last = screen.getByRole('button', { name: /remind me later/i });

        await waitFor(() => expect(close).toHaveFocus());
        last.focus();
        fireEvent.keyDown(document, { key: 'Tab' });
        expect(close).toHaveFocus();
    });

    it('pulls focus back when something moves it behind the modal', async () => {
        render(
            <>
                <button type="button">Behind the dialog</button>
                <UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />
            </>,
        );
        const dialog = screen.getByRole('dialog', { name: /update available/i });
        await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

        // Trapping Tab alone does not cover a caret the browser or an assistive tool
        // moves on its own, which would leave the page behind a blocking modal
        // reachable.
        const behind = screen.getByRole('button', { name: /behind the dialog/i });
        behind.focus();
        fireEvent.focusIn(behind);

        expect(dialog).toHaveFocus();
    });

    it('refuses to let the transfer be dismissed while it is in flight', async () => {
        let resolveInstall: ((value: { success: boolean }) => void) | undefined;
        mocks.downloadAndInstallUpdate.mockImplementation(
            () =>
                new Promise<{ success: boolean }>((resolve) => {
                    resolveInstall = resolve;
                }),
        );
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        await waitFor(() => expect(mocks.downloadAndInstallUpdate).toHaveBeenCalledTimes(1));

        // The APK in flight is the only copy, so dismissing here would let the
        // install finish invisibly with no way to see or retry it.
        expect(screen.getByRole('button', { name: /remind me later/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /manual browser installation/i })).toBeDisabled();
        expect(screen.queryByRole('button', { name: /close update dialog/i })).not.toBeInTheDocument();

        resolveInstall?.({ success: true });
        await waitFor(() => expect(screen.getByText(/handed to the Android package installer/i)).toBeInTheDocument());
    });

    it('re-reads the install permission after the settings screen so a granted prompt can be retried', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);
        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText('Android permission to install packages is required.')).toBeInTheDocument();

        // The user leaves for Settings and grants the permission; the dialog comes
        // back still claiming a refusal, with nothing to tell them to just retry.
        mocks.checkInstallPermission.mockResolvedValue({ granted: true });
        fireEvent.click(screen.getByRole('button', { name: /grant install permission/i }));

        await waitFor(() => expect(mocks.openInstallPermissionSettings).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(screen.queryByText('Android permission to install packages is required.')).not.toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: /grant install permission/i })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: /update now/i })).toBeEnabled();
    });

    it('keeps the refusal when the permission is still missing after the settings trip', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);
        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText('Android permission to install packages is required.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /grant install permission/i }));

        await waitFor(() => expect(mocks.checkInstallPermission).toHaveBeenCalledTimes(2));
        expect(screen.getByText('Android permission to install packages is required.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /grant install permission/i })).toBeInTheDocument();
    });

    it('opens the install settings once even if the control is double-pressed', async () => {
        let releaseSettings: (() => void) | undefined;
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        mocks.openInstallPermissionSettings.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    releaseSettings = resolve;
                }),
        );
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);
        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        const grant = await screen.findByRole('button', { name: /grant install permission/i });

        fireEvent.click(grant);
        fireEvent.click(grant);

        // The guard closes synchronously, so the second press is dropped before the
        // bridge module has even finished loading.
        await waitFor(() => expect(mocks.openInstallPermissionSettings).toHaveBeenCalledTimes(1));
        releaseSettings?.();
        await waitFor(() => expect(mocks.checkInstallPermission).toHaveBeenCalledTimes(2));
        expect(mocks.openInstallPermissionSettings).toHaveBeenCalledTimes(1);
    });

    it('keeps a download failure visible when the app is backgrounded and resumed', async () => {
        // The re-probe runs on every foreground, not only after a settings trip.
        // Clearing unconditionally made it wipe a failure that had nothing to do
        // with the permission, leaving a dialog that looked idle with no
        // explanation of what went wrong.
        mocks.downloadAndInstallUpdate.mockResolvedValue({ success: false, error: 'APK transfer interrupted' });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);
        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText('APK transfer interrupted')).toBeInTheDocument();

        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        // A second call is the proof the re-probe actually ran, rather than the
        // one `handleUpdate` made on its way to the failure.
        await waitFor(() => expect(mocks.checkInstallPermission).toHaveBeenCalledTimes(2));
        expect(screen.getByText('APK transfer interrupted')).toBeInTheDocument();
    });

    it('still turns a recorded refusal into a retry on resume', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);
        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText('Android permission to install packages is required.')).toBeInTheDocument();

        // The user grants the permission in Settings and comes back through the
        // app's own resume event rather than through a control this dialog owns.
        mocks.checkInstallPermission.mockResolvedValue({ granted: true });
        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        await waitFor(() =>
            expect(screen.queryByText('Android permission to install packages is required.')).not.toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: /grant install permission/i })).not.toBeInTheDocument();
    });

    it('leaves a recorded refusal alone when the permission is still missing on resume', async () => {
        mocks.checkInstallPermission.mockResolvedValue({ granted: false });
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);
        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText('Android permission to install packages is required.')).toBeInTheDocument();

        await act(async () => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        await waitFor(() => expect(mocks.checkInstallPermission).toHaveBeenCalledTimes(2));
        expect(screen.getByText('Android permission to install packages is required.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /grant install permission/i })).toBeInTheDocument();
    });

    it('does not strand the caret on the body when the trigger is gone at close', async () => {
        const CloseHarness = () => {
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
                            Check for updates
                        </button>
                    )}
                    {open && <UpdateModal isOpen onClose={() => setOpen(false)} updateInfo={update} />}
                </>
            );
        };
        render(<CloseHarness />);
        const trigger = screen.getByRole('button', { name: /check for updates/i });
        trigger.focus();
        fireEvent.click(trigger);
        await waitFor(() => expect(screen.getByRole('button', { name: /close update dialog/i })).toHaveFocus());

        // The trigger unmounts with the dialog, so focusing it would be a silent
        // no-op and the tab sequence would restart from the top of the page.
        fireEvent.click(screen.getByRole('button', { name: /close update dialog/i }));
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: /update available/i })).not.toBeInTheDocument(),
        );
        expect(document.body).toHaveFocus();
    });

    it('hands focus back to the trigger when it closes', async () => {
        const Harness = () => {
            const [open, setOpen] = useState(false);
            return (
                <>
                    <button type="button" onClick={() => setOpen(true)}>
                        Check for updates
                    </button>
                    <UpdateModal isOpen={open} onClose={() => setOpen(false)} updateInfo={update} />
                </>
            );
        };
        render(<Harness />);
        const trigger = screen.getByRole('button', { name: /check for updates/i });
        trigger.focus();
        fireEvent.click(trigger);
        await waitFor(() => expect(screen.getByRole('button', { name: /close update dialog/i })).toHaveFocus());

        fireEvent.click(screen.getByRole('button', { name: /close update dialog/i }));
        await waitFor(() =>
            expect(screen.queryByRole('dialog', { name: /update available/i })).not.toBeInTheDocument(),
        );
        // The dialog is only mounted while open, so the restore happens on unmount
        // rather than on a close transition.
        expect(trigger).toHaveFocus();
    });

    it('restarts the flow for a newly detected release', async () => {
        mocks.downloadAndInstallUpdate.mockResolvedValue({ success: false, error: 'Stale release' });
        const { rerender } = render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);
        fireEvent.click(screen.getByRole('button', { name: /update now/i }));
        expect(await screen.findByText('Stale release')).toBeInTheDocument();

        rerender(<UpdateModal isOpen onClose={vi.fn()} updateInfo={{ ...update, tag: 'v9.1.0' }} />);

        await waitFor(() => expect(screen.queryByText('Stale release')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: /update now/i })).toBeEnabled();
    });

    it('renders nothing when it is closed and no update is known', () => {
        const { container } = render(<UpdateModal isOpen={false} onClose={vi.fn()} updateInfo={null} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('reports a rejected manual browser fallback', async () => {
        mocks.browserOpen.mockRejectedValue(new Error('no browser'));
        render(<UpdateModal isOpen onClose={vi.fn()} updateInfo={update} />);

        fireEvent.click(screen.getByRole('button', { name: /manual browser installation/i }));

        expect(await screen.findByText('The browser could not open the update page.')).toBeInTheDocument();
    });
});
