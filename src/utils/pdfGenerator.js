import jsPDF from 'jspdf';
import 'jspdf-autotable';

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export const generatePDF = async (data) => {
    const { date, subjects, checklistItems, qualityChecks, dayRating, errors } = data;

    const doc = new jsPDF();

    // Title
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("6-Hour Daily Study Tracker", 14, 22);

    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Date: ${date}`, 14, 32);

    // Table
    const tableHead = [["Subject", "Planned (min)", "Actual (min)", "KPI Done (Y/N)"]];
    const tableBody = subjects.map(s => [
        s.name,
        s.planned || "0",
        s.actual || "0",
        s.kpi || ""
    ]);

    // Total Row
    const totalPlanned = subjects.reduce((acc, curr) => acc + (parseFloat(curr.planned) || 0), 0);
    const totalActual = subjects.reduce((acc, curr) => acc + (parseFloat(curr.actual) || 0), 0);
    tableBody.push(["Total", totalPlanned, totalActual, ""]);

    doc.autoTable({
        startY: 40,
        head: tableHead,
        body: tableBody,
        theme: 'grid',
        headStyles: { fillColor: [220, 220, 220], textColor: 20, fontStyle: 'bold' }, // light grey
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
            0: { cellWidth: 50 },
            1: { cellWidth: 40, halign: 'center' },
            2: { cellWidth: 40, halign: 'center' },
            3: { cellWidth: 40, halign: 'center' }
        }
    });

    let finalY = doc.lastAutoTable.finalY + 10;

    // Output Checklist
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Output Checklist", 14, finalY);
    finalY += 8;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    checklistItems.forEach(item => {
        const symbol = item.checked ? "[x]" : "[ ]";
        doc.text(`${symbol} ${item.label}`, 14, finalY);
        finalY += 6;
    });

    finalY += 6;

    // Quality Check
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Quality Check", 14, finalY);
    finalY += 8;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    qualityChecks.forEach(check => {
        const symbol = check.checked ? "[x]" : "[ ]";
        doc.text(`${symbol} ${check.label}`, 14, finalY);
        finalY += 6;
    });

    finalY += 6;

    // Day Rating
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Day Rating", 14, finalY);
    finalY += 8;

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    const ratingText = dayRating ? dayRating : "Not rated";
    doc.text(`Rating: ${ratingText}`, 14, finalY);

    finalY += 10;

    // Check if we need a page break for the Error Log
    if (finalY > 250) {
        doc.addPage();
        finalY = 20;
    }

    // Error Log
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Error Log", 14, finalY);
    finalY += 5;

    const errorHead = [["Question", "Mistake", "Correct Logic"]];
    const errorBody = errors
        .filter(e => e.question || e.mistake || e.correctLogic)
        .map(e => [e.question, e.mistake, e.correctLogic]);

    // If empty, add empty rows like original
    if (errorBody.length === 0) {
        errorBody.push(["", "", ""], ["", "", ""], ["", "", ""]);
    }

    doc.autoTable({
        startY: finalY,
        head: errorHead,
        body: errorBody,
        theme: 'grid',
        headStyles: { fillColor: [220, 220, 220], textColor: 20, fontStyle: 'bold' },
        styles: { fontSize: 10, cellPadding: 3, overflow: 'linebreak' },
        columnStyles: {
            0: { cellWidth: 60 },
            1: { cellWidth: 60 },
            2: { cellWidth: 60 }
        }
    });

    const fileName = `Study_Tracker_${date}.pdf`;

    if (Capacitor.isNativePlatform()) {
        try {
            // Get base64 string without prefix
            const base64Data = doc.output('datauristring').split(',')[1];

            await Filesystem.writeFile({
                path: fileName,
                data: base64Data,
                directory: Directory.Documents,
            });
            alert(`✅ PDF Saved to Documents folder as ${fileName}`);
        } catch (e) {
            console.error("File Save Error", e);
            alert("❌ Failed to save PDF to device storage.");
        }
    } else {
        doc.save(fileName);
    }
};
