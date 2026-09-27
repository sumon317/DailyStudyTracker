import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AlarmPermissionModal from './AlarmPermissionModal';
import UpdateModal from './UpdateModal';

const mocks = vi.hoisted(() => ({
    downloadAndInstallUpdate: vi.fn(),
    native: true,
    checkInstallPermission: vi.fn(),
    openInstallPermissionSettings: vi.fn(),
    browserOpen: vi.fn(),
    addListener: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
    registerPlugin: vi.fn((name: string) => ({ __plugin: name })),
    Capacitor: {
        isNativePlatform: () => mocks.native,
        getPlatform: () => (mocks.native ? 'android' : 'web'),
    },
}));

vi.mock('@capacitor/browser', () => ({
    Browser: { open: mocks.browserOpen },
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

const update = {
    available: true,
    tag: 'v9.0.0',
    url: 'https://github.com/sumon317/DailyStudyTracker/releases/download/v9.0.0/app.apk',
    notes: 'Release notes',
    assetName: 'app.apk',
    sha256: 'a'.repeat(64),
    size: 1024,
};

/**
 * The shell can raise the alarm-permission dialog underneath the update dialog -
 * the first from the exact-alarm prompt on resume, the second from a release
 * check - and both used to install their own `keydown` and `focusin` listeners on
 * `document` while painting at the same `z-50`.
 */
describe('stacked modal dialogs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.native = true;
        mocks.checkInstallPermission.mockResolvedValue({ granted: true });
        mocks.openInstallPermissionSettings.mockResolvedValue(undefined);
        mocks.browserOpen.mockResolvedValue(undefined);
        mocks.addListener.mockResolvedValue({ remove: vi.fn() });
    });

    const permissionDialog = () => screen.getByRole('dialog', { name: /alarm permission needed/i });
    const updateDialog = () => screen.getByRole('dialog', { name: /update available/i });
    const zIndexOf = (dialog: HTMLElement) => Number(dialog.parentElement?.style.zIndex ?? '0');

    const renderStack = (
        order: 'permission-last' | 'update-last',
        onClose: { update: () => void; permission: () => void },
    ) => {
        const permission = <AlarmPermissionModal isOpen onClose={onClose.permission} onOpenSettings={vi.fn()} />;
        const updater = <UpdateModal isOpen onClose={onClose.update} updateInfo={update} />;
        return render(
            <div>
                {order === 'permission-last' ? (
                    <>
                        {updater}
                        {permission}
                    </>
                ) : (
                    <>
                        {permission}
                        {updater}
                    </>
                )}
            </div>,
        );
    };

    it('gives the keyboard to the dialog that was raised last, not the one painted last', async () => {
        const onClose = { update: vi.fn(), permission: vi.fn() };
        // The update dialog is painted last in the tree, so a shared `z-50` made it
        // the *visual* top even though the permission dialog was raised after it.
        renderStack('permission-last', onClose);

        // Pinned to the stack, not merely ordered: a hardcoded 50 on one of them
        // would still keep the two in the right relative order, and the caret
        // would then follow the keyboard rule into a dialog painted underneath.
        expect(zIndexOf(permissionDialog())).toBe(51);
        expect(zIndexOf(updateDialog())).toBe(50);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /close alarm permission dialog/i })).toHaveFocus(),
        );
        fireEvent.keyDown(document, { key: 'Escape' });

        // One Escape press used to dismiss both, because both were listening.
        expect(onClose.permission).toHaveBeenCalledTimes(1);
        expect(onClose.update).not.toHaveBeenCalled();
    });

    it('keeps the caret in the top dialog instead of letting the covered one take it back', async () => {
        renderStack('update-last', { update: vi.fn(), permission: vi.fn() });

        const topClose = screen.getByRole('button', { name: /close update dialog/i });
        await waitFor(() => expect(topClose).toHaveFocus());

        // The covered dialog's `focusin` handler used to yank focus to its own
        // container, so neither dialog's controls could hold the caret while both
        // were up.
        const coveredSettings = screen.getByRole('button', { name: /open settings/i });
        coveredSettings.focus();
        await waitFor(() => expect(coveredSettings).not.toHaveFocus());
        expect(updateDialog()).toContainElement(document.activeElement as HTMLElement);
    });

    it('hands the keyboard to the dialog that is left once the top one closes', async () => {
        const onClose = { update: vi.fn(), permission: vi.fn() };
        const Harness = () => {
            const [updateOpen, setUpdateOpen] = useState(true);
            return (
                <div>
                    <AlarmPermissionModal isOpen onClose={onClose.permission} onOpenSettings={vi.fn()} />
                    <UpdateModal
                        isOpen={updateOpen}
                        onClose={() => {
                            onClose.update();
                            setUpdateOpen(false);
                        }}
                        updateInfo={update}
                    />
                </div>
            );
        };
        render(<Harness />);

        // The update dialog registered last, so it owns Escape first - and it has to
        // be painted above the dialog it is covering, or the caret would follow the
        // keyboard rule into one the user cannot see.
        expect(zIndexOf(updateDialog())).toBe(51);
        expect(zIndexOf(permissionDialog())).toBe(50);

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose.update).toHaveBeenCalledTimes(1);
        expect(onClose.permission).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByRole('dialog', { name: /update available/i })).toBeNull());

        // ...and the one it was covering takes over rather than being left with a
        // live `aria-modal` dialog nobody can reach.
        expect(zIndexOf(permissionDialog())).toBe(50);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose.permission).toHaveBeenCalledTimes(1);
    });
});
