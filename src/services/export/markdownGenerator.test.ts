import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportData } from '../../types';
import { buildMarkdown, generateMarkdown } from './markdownGenerator';

const nativeState = vi.hoisted(() => ({ native: false }));

const writeFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => nativeState.native },
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: { Documents: 'DOCUMENTS', External: 'EXTERNAL', Data: 'DATA' },
    Encoding: { UTF8: 'utf8' },
    Filesystem: { writeFile },
}));

const makeData = (overrides: Partial<ExportData> = {}): ExportData => ({
    date: '2026-09-25',
    subjects: [{ id: 1, name: 'Accounts', planned: '60', actual: '45', kpi: 'Y', time: '08:00', reminder: false }],
    checklistItems: [{ id: 1, label: 'Read notes', checked: true }],
    qualityChecks: [{ id: 1, label: 'Understood the concept', checked: false }],
    dayRating: 'Productive',
    errors: [{ id: 1, question: 'Why debit?', mistake: 'Confused', correctLogic: 'Asset up' }],
    todos: [{ id: 5, text: 'Solve Q7', completed: false, time: '18:30', reminder: true }],
    ...overrides,
});

describe('markdownGenerator', () => {
    beforeEach(() => {
        nativeState.native = false;
        writeFile.mockClear();
    });

    describe('buildMarkdown', () => {
        it('escapes pipes and newlines in subject names so the table cannot be restructured', () => {
            const md = buildMarkdown(
                makeData({
                    subjects: [
                        {
                            id: 1,
                            name: 'Accounts | Economics\n| **Total** | 999 | 999 | x |',
                            planned: '60',
                            actual: '45',
                            kpi: 'Y',
                            time: '',
                            reminder: false,
                        },
                    ],
                }),
            );

            const subjectRows = md.split('\n').filter((line) => line.startsWith('| Accounts'));
            expect(subjectRows).toHaveLength(1);
            expect(md).toContain(
                '| Accounts \\| Economics \\| \\*\\*Total\\*\\* \\| 999 \\| 999 \\| x \\| | 60 | 45 | Y |',
            );
            expect(md.split('\n').filter((line) => line.startsWith('| **Total**'))).toHaveLength(1);
        });

        it('exports todos instead of silently dropping them', () => {
            const md = buildMarkdown(makeData());
            expect(md).toContain('## To-Do List');
            expect(md).toContain('- [ ] Solve Q7 _(18:30)_');
        });

        it('keeps totals numeric and consistent with the subject rows', () => {
            const md = buildMarkdown(
                makeData({
                    subjects: [
                        { id: 1, name: 'A', planned: '60', actual: '30.5', kpi: 'Y', time: '', reminder: false },
                        { id: 2, name: 'B', planned: '30', actual: '15', kpi: 'N', time: '', reminder: false },
                    ],
                }),
            );
            expect(md).toContain('| A | 60 | 30.5 | Y |');
            expect(md).toContain('| **Total** | **90** | **45.5** | |');
        });

        it('renders explicit empty-state lines rather than empty sections', () => {
            const md = buildMarkdown(
                makeData({ checklistItems: [], qualityChecks: [], todos: [], errors: [], dayRating: '' }),
            );
            expect(md).toContain('- [ ] No checklist items recorded.');
            expect(md).toContain('- [ ] No quality checks recorded.');
            expect(md).toContain('No to-do items.');
            expect(md).toContain('No errors logged.');
            expect(md).toContain('**Rating:** Not rated');
        });

        it('strips control characters from the exported date', () => {
            expect(buildMarkdown(makeData({ date: '2026-09-25\u0007' }))).toContain('**Date:** 2026-09-25');
        });
    });

    describe('generateMarkdown', () => {
        it('writes to the app-private external directory instead of public Documents', async () => {
            nativeState.native = true;
            await generateMarkdown(makeData());

            expect(writeFile).toHaveBeenCalledTimes(1);
            expect(writeFile).toHaveBeenCalledWith(
                expect.objectContaining({
                    path: 'Study_Tracker_2026-09-25.md',
                    directory: 'EXTERNAL',
                    encoding: 'utf8',
                }),
            );
            expect(writeFile.mock.calls[0]?.[0]?.directory).not.toBe('DOCUMENTS');
        });

        it('propagates filesystem write failures', async () => {
            nativeState.native = true;
            writeFile.mockRejectedValueOnce(new Error('disk full'));
            await expect(generateMarkdown(makeData())).rejects.toThrow('disk full');
        });
    });
});
