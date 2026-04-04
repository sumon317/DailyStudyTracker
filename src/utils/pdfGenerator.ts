import jsPDF from 'jspdf';
import 'jspdf-autotable';

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import type { ChecklistItem, ErrorLogEntry, QualityCheckItem, Subject, Todo } from '../types';
import { sanitizeText } from './sanitize';

interface ExportData {
    date: string;
    subjects: Subject[];
    checklistItems: ChecklistItem[];
    qualityChecks: QualityCheckItem[];
    dayRating: string;
    errors: ErrorLogEntry[];
    todos: Todo[];
}

export const generatePDF = async (data: ExportData) => {
    const { date, subjects, checklistItems, qualityChecks, dayRating, errors } = data;

    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Daily Study Tracker', 14, 22);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Date: ${date}`, 14, 32);

    const tableHead = [['Subject', 'Planned (min)', 'Actual (min)', 'KPI Done (Y/N)']];
    const tableBody = subjects.map((s) => [
        sanitizeText(s.name),
        String(s.planned || '0'),
        String(s.actual || '0'),
        sanitizeText(s.kpi),
    ]);

    const totalPlanned = subjects.reduce((acc, curr) => acc + (parseFloat(curr.planned) || 0), 0);
    const totalActual = subjects.reduce((acc, curr) => acc + (parseFloat(curr.actual) || 0), 0);
    tableBody.push(['Total', String(totalPlanned), String(totalActual), '']);

    const autoTable = (doc as unknown as Record<string, ((opts: Record<string, unknown>) => void) | undefined>)
        .autoTable;
    if (autoTable) {
        autoTable({
            startY: 40,
            head: tableHead,
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 220, 220], textColor: 20, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 50 },
                1: { cellWidth: 40, halign: 'center' },
                2: { cellWidth: 40, halign: 'center' },
                3: { cellWidth: 40, halign: 'center' },
            },
        });
    }

    let finalY = (doc as unknown as Record<string, { finalY: number } | undefined>).lastAutoTable?.finalY ?? 40;
    finalY += 10;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Output Checklist', 14, finalY);
    finalY += 8;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    checklistItems.forEach((item) => {
        const symbol = item.checked ? '[x]' : '[ ]';
        doc.text(`${symbol} ${sanitizeText(item.label)}`, 14, finalY);
        finalY += 6;
    });

    finalY += 6;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Quality Check', 14, finalY);
    finalY += 8;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    qualityChecks.forEach((check) => {
        const symbol = check.checked ? '[x]' : '[ ]';
        doc.text(`${symbol} ${sanitizeText(check.label)}`, 14, finalY);
        finalY += 6;
    });

    finalY += 6;

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Day Rating', 14, finalY);
    finalY += 8;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const ratingText = dayRating ? sanitizeText(dayRating) : 'Not rated';
    doc.text(`Rating: ${ratingText}`, 14, finalY);

    finalY += 10;

    if (finalY > 250) {
        doc.addPage();
        finalY = 20;
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Error Log', 14, finalY);
    finalY += 5;

    const errorHead = [['Question', 'Mistake', 'Correct Logic']];
    const errorBody = errors
        .filter((e) => e.question || e.mistake || e.correctLogic)
        .map((e) => [e.question, e.mistake, e.correctLogic]);

    if (errorBody.length === 0) {
        errorBody.push(['', '', ''], ['', '', ''], ['', '', '']);
    }

    const autoTable2 = (doc as unknown as Record<string, ((opts: Record<string, unknown>) => void) | undefined>)
        .autoTable;
    if (autoTable2) {
        autoTable2({
            startY: finalY,
            head: errorHead,
            body: errorBody,
            theme: 'grid',
            headStyles: { fillColor: [220, 220, 220], textColor: 20, fontStyle: 'bold' },
            styles: { fontSize: 10, cellPadding: 3, overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 60 },
                1: { cellWidth: 60 },
                2: { cellWidth: 60 },
            },
        });
    }

    const fileName = `Study_Tracker_${date}.pdf`;

    if (Capacitor.isNativePlatform()) {
        try {
            const base64Data = doc.output('datauristring').split(',')[1] ?? '';

            await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: Directory.Documents,
            });
            alert(`✅ PDF Saved to Documents folder as ${fileName}`);
        } catch (_e) {
            alert('❌ Failed to save PDF to device storage.');
        }
    } else {
        doc.save(fileName);
    }
};
