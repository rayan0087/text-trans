import React, { useState } from 'react';
import { Copy, Check, Sparkles, FileText, FileDown, Loader2 } from 'lucide-react';
import { exportToTxt, exportToDocx } from '../services/exportService';
import { type TranscriptRecord } from '../db';

interface ExportToolbarProps {
  currentRecord: Partial<TranscriptRecord>;
  onOpenAiAssistant: () => void;
}

export const ExportToolbar: React.FC<ExportToolbarProps> = ({
  currentRecord,
  onOpenAiAssistant,
}) => {
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
    <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs p-3.5 flex flex-wrap items-center justify-between gap-3">
      {/* Left Action: AI Assistant Trigger */}
      <button
        onClick={onOpenAiAssistant}
        className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl text-xs font-semibold shadow-sm shadow-indigo-200 hover:shadow-indigo-300 transition-all active:scale-95"
      >
        <Sparkles className="w-4 h-4" />
        <span>Asisten AI (Rapikan / Ringkas)</span>
      </button>

      {/* Right Actions: Copy & Exports */}
      <div className="flex items-center gap-2">
        {/* Copy Button */}
        <button
          onClick={handleCopy}
          disabled={!hasContent}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-all disabled:opacity-50"
          title="Salin seluruh teks transkrip"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Tersalin!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 text-slate-500" />
              <span>Salin</span>
            </>
          )}
        </button>

        {/* Export TXT */}
        <button
          onClick={handleExportTxt}
          disabled={!hasContent}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200/80 rounded-xl transition-all disabled:opacity-50"
          title="Unduh sebagai file Teks (.txt)"
        >
          <FileText className="w-4 h-4 text-slate-500" />
          <span>Ekspor .TXT</span>
        </button>

        {/* Export DOCX */}
        <button
          onClick={handleExportDocx}
          disabled={!hasContent || exportingDocx}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/80 border border-blue-200/70 rounded-xl transition-all disabled:opacity-50"
          title="Unduh sebagai Microsoft Word (.docx)"
        >
          {exportingDocx ? (
            <>
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              <span>Membuat .DOCX...</span>
            </>
          ) : (
            <>
              <FileDown className="w-4 h-4 text-blue-600" />
              <span>Ekspor .DOCX</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
