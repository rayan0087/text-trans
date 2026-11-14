import React, { useState } from 'react';
import { Copy, Check, FileText, FileDown, Loader2, Sparkles } from 'lucide-react';
import { exportToTxt, exportToDocx } from '../services/exportService';
import { type TranscriptRecord } from '../db';

interface ExportToolbarProps {
  currentRecord: Partial<TranscriptRecord>;
}

export const ExportToolbar: React.FC<ExportToolbarProps> = ({ currentRecord }) => {
  const [copied, setCopied] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);

  const handleCopy = () => {
    if (!currentRecord.content) return;
    navigator.clipboard.writeText(currentRecord.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportTxt = () => {
    exportToTxt(currentRecord);
  };

  const handleExportDocx = async () => {
    try {
      setExportingDocx(true);
      await exportToDocx(currentRecord);
    } catch (err) {
      console.error('Error exporting DOCX:', err);
      alert('Gagal mengekspor dokumen Word (.docx)');
    } finally {
      setExportingDocx(false);
    }
  };

  const hasContent = !!(currentRecord.content && currentRecord.content.trim().length > 0);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs p-3.5 flex flex-wrap items-center justify-between gap-3 transition-colors">
      {/* Left indicator */}
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <span>Ekspor transkrip hasil akurat langsung ke berkas Word atau Teks</span>
      </div>

      {/* Right Actions: Copy & Exports */}
      <div className="flex items-center gap-2">
        {/* Copy Button */}
        <button
          onClick={handleCopy}
          disabled={!hasContent}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl transition-all disabled:opacity-50"
          title="Salin seluruh teks transkrip"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Tersalin!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <span>Salin Teks</span>
            </>
          )}
        </button>

        {/* Export TXT */}
        <button
          onClick={handleExportTxt}
          disabled={!hasContent}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200/80 dark:hover:bg-slate-700 rounded-xl transition-all disabled:opacity-50"
          title="Unduh sebagai file Teks (.txt)"
        >
          <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span>Ekspor .TXT</span>
        </button>

        {/* Export DOCX */}
        <button
          onClick={handleExportDocx}
          disabled={!hasContent || exportingDocx}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100/80 dark:hover:bg-blue-900/50 border border-blue-200/70 dark:border-blue-800 rounded-xl transition-all disabled:opacity-50"
          title="Unduh sebagai Microsoft Word (.docx)"
        >
          {exportingDocx ? (
            <>
              <Loader2 className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
              <span>Membuat .DOCX...</span>
            </>
          ) : (
            <>
              <FileDown className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Ekspor .DOCX</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
