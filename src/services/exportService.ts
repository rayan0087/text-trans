import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';
import { type TranscriptRecord } from '../db';

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(new Date(date));
}

/**
 * Export transcript as plain text (.txt)
 */
export function exportToTxt(record: Partial<TranscriptRecord>): void {
  const title = record.title || 'Transkrip Tanpa Judul';
  const dateStr = record.createdAt ? formatDate(record.createdAt) : new Date().toLocaleString('id-ID');
  const durationStr = formatDuration(record.durationSeconds || 0);

  let textContent = `=========================================\n`;
  textContent += `${title.toUpperCase()}\n`;
  textContent += `=========================================\n`;
  textContent += `Tanggal   : ${dateStr}\n`;
  textContent += `Durasi    : ${durationStr}\n`;
  textContent += `Bahasa    : ${record.language || 'id-ID'}\n`;
  textContent += `=========================================\n\n`;

  textContent += `--- KONTEN TRANSKRIP ---\n\n`;
  textContent += `${record.content || '(Tidak ada rekaman teks)'}\n\n`;

  if (record.aiSummary) {
    textContent += `-----------------------------------------\n`;
    textContent += `--- RINGKASAN AI ---\n\n`;
    textContent += `${record.aiSummary}\n\n`;
  }

  if (record.aiActionItems) {
    textContent += `-----------------------------------------\n`;
    textContent += `--- ACTION ITEMS & KEPUTUSAN ---\n\n`;
    textContent += `${record.aiActionItems}\n\n`;
  }

  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
  const sanitizedTitle = title.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  saveAs(blob, `${sanitizedTitle || 'transkrip'}.txt`);
}

/**
 * Export transcript as Microsoft Word (.docx)
 */
export async function exportToDocx(record: Partial<TranscriptRecord>): Promise<void> {
  const title = record.title || 'Transkrip Tanpa Judul';
  const dateStr = record.createdAt ? formatDate(record.createdAt) : new Date().toLocaleString('id-ID');
  const durationStr = formatDuration(record.durationSeconds || 0);

  const docChildren: Paragraph[] = [
    // Title
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),

    // Metadata Subtitle
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `Dibuat: ${dateStr}`, italics: true, color: '64748b' }),
        new TextRun({ text: `  |  Durasi: ${durationStr}`, italics: true, color: '64748b' }),
        new TextRun({ text: `  |  Bahasa: ${record.language || 'id-ID'}`, italics: true, color: '64748b' }),
      ],
      spacing: { after: 400 },
    }),

    // Heading Transkrip
    new Paragraph({
      text: 'Transkrip',
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 200, after: 120 },
    }),
  ];

  // Split content by paragraphs or newlines
  const paragraphs = (record.content || '(Tidak ada rekaman teks)')
    .split('\n')
    .filter((p) => p.trim().length > 0);

  if (paragraphs.length === 0) {
    docChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '(Transkrip kosong)', italics: true })],
        spacing: { after: 120 },
      })
    );
  } else {
    for (const para of paragraphs) {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 24 })], // 12pt
          spacing: { after: 160 },
        })
      );
    }
  }

  // AI Summary if available
  if (record.aiSummary) {
    docChildren.push(
      new Paragraph({
        text: 'Ringkasan AI',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 120 },
      })
    );

    const summaryParas = record.aiSummary.split('\n').filter((p) => p.trim().length > 0);
    for (const para of summaryParas) {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 24, color: '1e293b' })],
          spacing: { after: 140 },
        })
      );
    }
  }

  // AI Action Items if available
  if (record.aiActionItems) {
    docChildren.push(
      new Paragraph({
        text: 'Action Items & Keputusan',
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300, after: 120 },
      })
    );

    const actionParas = record.aiActionItems.split('\n').filter((p) => p.trim().length > 0);
    for (const para of actionParas) {
      docChildren.push(
        new Paragraph({
          children: [new TextRun({ text: para, size: 24, color: '0f766e' })],
          spacing: { after: 140 },
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const sanitizedTitle = title.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  saveAs(blob, `${sanitizedTitle || 'transkrip'}.docx`);
}
