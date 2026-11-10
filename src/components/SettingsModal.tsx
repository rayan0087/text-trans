import React, { useState, useEffect } from 'react';
import { X, Key, ShieldCheck, ExternalLink, Save, CheckCircle2, RefreshCw, Loader2 } from 'lucide-react';
import { 
  type AIProvider, 
  type AISettings, 
  detectProviderFromKey, 
  DEFAULT_MODELS, 
  fetchAvailableModels 
} from '../services/aiService';
import { getSetting, setSetting } from '../db';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onSaved }) => {
  const [provider, setProvider] = useState<AIProvider>('groq');
  const [apiKey, setApiKey] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [modelsList, setModelsList] = useState<string[]>(DEFAULT_MODELS.groq);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      setSavedSuccess(false);
    }
  }, [isOpen]);

  const loadSettings = async () => {
    const saved = await getSetting<AISettings>('ai_settings', {
      provider: 'groq',
      apiKey: '',
    });
    const currentProv = saved.provider || 'groq';
    setProvider(currentProv);
    setApiKey(saved.apiKey || '');
    setCustomModel(saved.customModel || DEFAULT_MODELS[currentProv][0]);
    setModelsList(DEFAULT_MODELS[currentProv]);

    // If key exists, automatically fetch active models
    if (saved.apiKey) {
      loadModelsFor(currentProv, saved.apiKey, saved.customModel);
    }
  };

  const loadModelsFor = async (prov: AIProvider, key: string, keepSelected?: string) => {
    if (!key.trim()) {
      setModelsList(DEFAULT_MODELS[prov]);
      return;
    }
    setIsLoadingModels(true);
    try {
      const fetched = await fetchAvailableModels(prov, key);
      setModelsList(fetched);
      if (keepSelected && fetched.includes(keepSelected)) {
        setCustomModel(keepSelected);
      } else if (fetched.length > 0) {
        setCustomModel(fetched[0]);
      }
    } catch (e) {
      console.warn('Failed to fetch models:', e);
      setModelsList(DEFAULT_MODELS[prov]);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleKeyChange = (val: string) => {
    setApiKey(val);
    const detected = detectProviderFromKey(val);
    if (detected && detected !== provider) {
      setProvider(detected);
      loadModelsFor(detected, val);
    } else if (val.trim()) {
      loadModelsFor(provider, val);
    }
  };

  const handleProviderSelect = (newProv: AIProvider) => {
    setProvider(newProv);
    loadModelsFor(newProv, apiKey);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const actualProvider = detectProviderFromKey(apiKey) || provider;
    const settings: AISettings = {
      provider: actualProvider,
      apiKey: apiKey.trim(),
      customModel: customModel.trim() || undefined,
    };
    await setSetting('ai_settings', settings);
    setSavedSuccess(true);
    if (onSaved) onSaved();
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 1000);
  };

  if (!isOpen) return null;

  const getProviderInfo = () => {
    switch (provider) {
      case 'gemini':
        return {
          name: 'Google Gemini',
          badge: 'Audio & Teks (Gratis)',
          link: 'https://aistudio.google.com/app/apikey',
          linkText: 'Dapatkan API Key Gemini di Google AI Studio',
          placeholder: 'AIzaSy...',
          defaultModel: 'gemini-1.5-flash',
        };
      case 'groq':
        return {
          name: 'Groq Cloud',
          badge: 'Whisper AI Turbo (Gratis & Sangat Cepat)',
          link: 'https://console.groq.com/keys',
          linkText: 'Dapatkan API Key Groq di Groq Console',
          placeholder: 'gsk_...',
          defaultModel: 'llama-3.1-8b-instant',
        };
      case 'openai':
        return {
          name: 'OpenAI (ChatGPT)',
          badge: 'Whisper & GPT-4o',
          link: 'https://platform.openai.com/api-keys',
          linkText: 'Dapatkan API Key OpenAI di Platform OpenAI',
          placeholder: 'sk-...',
          defaultModel: 'gpt-4o-mini',
        };
    }
  };

  const providerInfo = getProviderInfo();
  const detected = detectProviderFromKey(apiKey);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-lg overflow-hidden transition-all">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2 text-slate-800 font-semibold text-lg">
            <Key className="w-5 h-5 text-indigo-600" />
            <span>Pengaturan AI (Bring Your Own Key)</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 rounded-lg p-1 hover:bg-slate-200/50 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Privacy Note */}
          <div className="flex items-start gap-3 p-3.5 bg-emerald-50 border border-emerald-200/70 rounded-xl text-xs text-emerald-800">
            <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-emerald-900">100% Aman & Terisolasi di Browser</p>
              <p className="mt-0.5 leading-relaxed">
                API Key Anda hanya disimpan di IndexedDB browser Anda sendiri. Tidak ada server perantara yang merekam data atau suara Anda.
              </p>
            </div>
          </div>

          {/* 1. API Key Input First */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Tempelkan API Key Anda
              </label>
              <a
                href={providerInfo.link}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 hover:underline font-medium"
              >
                <span>{providerInfo.linkText}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => handleKeyChange(e.target.value)}
              placeholder="Tempel kunci API Anda di sini (gsk_... / AIzaSy... / sk-...)"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-mono"
            />
            {detected && (
              <p className="text-xs text-emerald-600 font-semibold mt-1.5 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Penyedia otomatis terdeteksi: <strong>{providerInfo.name}</strong></span>
              </p>
            )}
            {!detected && apiKey.trim() && (
              <p className="text-[11px] text-slate-400 mt-1">
                Pilih penyedia manual di bawah jika format tidak dikenali.
              </p>
            )}
          </div>

          {/* 2. Provider Selection Tabs (Optional / Override) */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
              Penyedia AI Aktif
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'groq', label: 'Groq Cloud', tag: 'Whisper Turbo' },
                { id: 'gemini', label: 'Gemini', tag: 'Gratis' },
                { id: 'openai', label: 'OpenAI', tag: 'GPT' },
              ].map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => handleProviderSelect(item.id as AIProvider)}
                  className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                    provider === item.id
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-900 ring-2 ring-indigo-500/20 shadow-xs'
                      : 'border-slate-200 hover:border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={`text-[10px] mt-0.5 px-1.5 py-0.2 rounded-full ${
                    provider === item.id ? 'bg-indigo-200 text-indigo-800 font-semibold' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {item.tag}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* 3. Model Selection Dropdown */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Pilihan Model
              </label>
              <button
                type="button"
                onClick={() => loadModelsFor(provider, apiKey)}
                disabled={isLoadingModels || !apiKey.trim()}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:opacity-40 transition-colors"
                title="Ambil daftar model yang tersedia langsung dari akun API Anda"
              >
                {isLoadingModels ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Mengambil...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-3 h-3" />
                    <span>Muat Ulang Model Akun</span>
                  </>
                )}
              </button>
            </div>

            <select
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all cursor-pointer"
            >
              {modelsList.map((m) => (
                <option key={m} value={m}>
                  {m} {m === DEFAULT_MODELS[provider][0] ? '(Direkomendasikan)' : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Model dipilih otomatis dari akun Anda. Tidak perlu mengetik manual.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold shadow-sm shadow-indigo-200 transition-all active:scale-98"
            >
              {savedSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  <span>Tersimpan!</span>
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>Simpan Pengaturan</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
