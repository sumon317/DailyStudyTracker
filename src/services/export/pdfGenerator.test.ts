import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportData } from '../../types';
import { generatePDF } from './pdfGenerator';

const nativeState = vi.hoisted(() => ({
    native: false,
    output: 'data:application/pdf;base64,QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3g=',
}));

const writeFile = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const pdfCalls = vi.hoisted(() => ({ text: [] as string[], addPage: 0, save: [] as string[], data: '' as string }));

vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => nativeState.native },
}));

vi.mock('@capacitor/filesystem', () => ({
    Directory: { Documents: 'DOCUMENTS', External: 'EXTERNAL', Data: 'DATA' },
    Filesystem: { writeFile },
}));

vi.mock('jspdf', () => {
    class FakeJsPdf {
        setFontSize() {
            return this;
        }

        setFont() {
            return this;
        }

        text(value: string) {
            pdfCalls.text.push(value);
            return this;
        }

        addPage() {
            pdfCalls.addPage += 1;
            return this;
        }

        autoTable() {
            return this;
        }

        lastAutoTable = { finalY: 60 };

        output() {
            return nativeState.output;
        }

        save(name: string) {
            pdfCalls.save.push(name);
        }
    }
    return { default: FakeJsPdf };
});

vi.mock('jspdf-autotable', () => ({}));

const makeData = (overrides: Partial<ExportData> = {}): ExportData => ({
    date: '2026-09-25',
    subjects: [{ id: 1, name: 'Accounts', planned: '60', actual: '45', kpi: 'Y', time: '08:00', reminder: false }],
    checklistItems: [{ id: 1, label: 'Read notes', checked: true }],
    qualityChecks: [{ id: 1, label: 'Understood', checked: false }],
    dayRating: 'Productive',
    errors: [{ id: 1, question: 'Why debit?', mistake: 'Confused', correctLogic: 'Asset up' }],
    todos: [{ id: 5, text: 'Solve Q7', completed: false, time: '18:30', reminder: true }],
    ...overrides,
});

describe('pdfGenerator', () => {
    beforeEach(() => {
        nativeState.native = false;
        nativeState.output =
            'data:application/pdf;base64,QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3g=';
        writeFile.mockClear();
        pdfCalls.text = [];
        pdfCalls.addPage = 0;
        pdfCalls.save = [];
    });

    it('writes the PDF to the app-private external directory instead of public Documents', async () => {
        nativeState.native = true;
        await generatePDF(makeData());

        expect(writeFile).toHaveBeenCalledTimes(1);
        expect(writeFile).toHaveBeenCalledWith(
            expect.objectContaining({
                path: 'Study_Tracker_2026-09-25.pdf',
                directory: 'EXTERNAL',
                data: 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3g=',
            }),
        );
        expect(writeFile.mock.calls[0]?.[0]?.directory).not.toBe('DOCUMENTS');
    });

    it('propagates filesystem write failures', async () => {
        nativeState.native = true;
        writeFile.mockRejectedValueOnce(new Error('disk full'));
        await expect(generatePDF(makeData())).rejects.toThrow('disk full');
    });

    it('fails loudly instead of writing an empty document when serialisation yields no data', async () => {
        nativeState.native = true;
        nativeState.output = 'data:application/pdf;base64,';
        await expect(generatePDF(makeData())).rejects.toThrow(/no usable document data/i);
        expect(writeFile).not.toHaveBeenCalled();
    });

    it('prints the text verbatim instead of its HTML escape sequences', async () => {
        // `doc.text` writes the string straight into a text run: there is no
        // markup to escape it out of, so the entity encoder used to print its own
        // output - a checklist item called `A & B` came out as `A &amp; B`.
        await generatePDF(
            makeData({
                checklistItems: [{ id: 1, label: 'Read A & B <notes>', checked: false }],
                todos: [{ id: 5, text: 'Solve Q7 & Q8', completed: false, time: '', reminder: false }],
            }),
        );

        expect(pdfCalls.text).toContain('[ ] Read A & B <notes>');
        expect(pdfCalls.text).toContain('[ ] Solve Q7 & Q8');
        expect(pdfCalls.text.some((run) => run.includes('&amp;') || run.includes('&lt;'))).toBe(false);
    });

    it('still drops the invisible formatting characters a text run must not carry', async () => {
        // Character-level cleanup is not the same thing as encoding: a bidi
        // override survives verbatim and makes the text read differently from
        // what is stored, so it has to go even though nothing has to be escaped.
        await generatePDF(
            makeData({
                checklistItems: [{ id: 1, label: 'Read\u202E notes', checked: false }],
            }),
        );

        const runs = pdfCalls.text.join('\n');
        expect(runs).toContain('Read notes');
        expect(runs).not.toContain('\u202E');
        expect(runs).not.toContain('\u200B');
    });

    it('includes todos and empty-state placeholders in the rendered text', async () => {
        await generatePDF(makeData());
        expect(pdfCalls.text).toContain('[ ] Solve Q7 (18:30)');
        expect(pdfCalls.text).toContain('To-Do List');

        pdfCalls.text = [];
        await generatePDF(makeData({ checklistItems: [], qualityChecks: [], todos: [], errors: [], dayRating: '' }));
        expect(pdfCalls.text).toContain('[ ] No checklist items recorded.');
        expect(pdfCalls.text).toContain('[ ] No quality checks recorded.');
        expect(pdfCalls.text).toContain('No to-do items.');
        expect(pdfCalls.text).toContain('Rating: Not rated');
    });

    it('paginates long lists instead of silently clipping them off the page', async () => {
        const many = Array.from({ length: 60 }, (_value, index) => ({
            id: index + 1,
            label: `Item ${index + 1}`,
            checked: false,
        }));
        const manyTodos = Array.from({ length: 60 }, (_value, index) => ({
            id: index + 1,
            text: `Item ${index + 1}`,
            completed: false,
            time: '18:30',
            reminder: false,
        }));

        await generatePDF(makeData({ checklistItems: many, qualityChecks: many, todos: manyTodos }));

        expect(pdfCalls.addPage).toBeGreaterThan(2);
        expect(pdfCalls.text.filter((line) => line.startsWith('[ ] Item '))).toHaveLength(180);
    });
});
