export type AIProvider = 'gemini' | 'groq' | 'openai';

export interface AISettings {
  provider: AIProvider;
  apiKey: string;
  customModel?: string;
}

export interface AIResponse {
  success: boolean;
  result?: string;
  error?: string;
}

/**
 * Detect AI provider from API key format
 */
export function detectProviderFromKey(apiKey: string): AIProvider | null {
  const trimmed = apiKey.trim();
  if (trimmed.startsWith('gsk_')) return 'groq';
  if (trimmed.startsWith('AIzaSy')) return 'gemini';
  if (trimmed.startsWith('sk-') && !trimmed.startsWith('gsk_')) return 'openai';
  return null;
}

/**
 * Convert Blob to Base64 (without data: prefix)
 */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Call Google Gemini API (Text) with version & model fallbacks
 */
async function callGemini(apiKey: string, prompt: string, model: string = 'gemini-1.5-flash'): Promise<string> {
  const attempts = [
    { ver: 'v1beta', model: model },
    { ver: 'v1beta', model: 'gemini-1.5-flash-latest' },
    { ver: 'v1beta', model: 'gemini-2.0-flash' },
    { ver: 'v1', model: 'gemini-1.5-flash' },
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/${attempt.ver}/models/${attempt.model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      } else {
        const errorData = await response.json().catch(() => ({}));
        lastError = errorData.error?.message || `${response.status} ${response.statusText}`;
      }
    } catch (e: any) {
      lastError = e.message;
    }
  }

  throw new Error(lastError || 'Gagal memproses permintaan teks dengan Gemini.');
}

/**
 * Call Gemini Audio Multimodal with fallbacks
 */
async function callGeminiAudio(apiKey: string, base64Audio: string, mimeType: string): Promise<string> {
  const attempts = [
    { ver: 'v1beta', model: 'gemini-1.5-flash' },
    { ver: 'v1beta', model: 'gemini-1.5-flash-latest' },
    { ver: 'v1beta', model: 'gemini-2.0-flash' },
    { ver: 'v1', model: 'gemini-1.5-flash' },
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/${attempt.ver}/models/${attempt.model}:generateContent?key=${apiKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  inlineData: {
                    mimeType: mimeType || 'audio/webm',
                    data: base64Audio,
                  },
                },
                {
                  text: 'Tolong transkripsikan audio percakapan ini ke dalam teks secara sangat akurat. Pertahankan istilah teknis/asing (seperti rework, DNS, SMS, database, deploy, dsb) sesuai konteks percakapan. Berikan tanda baca yang lengkap dan huruf kapital yang benar. Keluarkan HANYA teks hasil transkripsinya saja tanpa kata pengantar atau penutup apapun.',
                },
              ],
            },
          ],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      } else {
        const errorData = await response.json().catch(() => ({}));
        lastError = errorData.error?.message || `${response.status} ${response.statusText}`;
      }
    } catch (e: any) {
      lastError = e.message;
    }
  }

  throw new Error(lastError || 'Gagal memproses audio dengan Gemini.');
}

/**
 * Call OpenAI-compatible API (Groq, OpenAI) for text
 */
async function callOpenAICompatible(
  endpoint: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Tidak ada respon teks dari penyedia AI.');
  }
  return text.trim();
}

/**
 * Transcribe Audio using Whisper AI (Groq Whisper / OpenAI Whisper / Gemini Audio)
 */
export async function transcribeAudio(
  settings: AISettings,
  audioBlob: Blob,
  language: string = 'id-ID'
): Promise<AIResponse> {
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return {
      success: false,
      error: 'API Key belum diatur. Masukkan API Key di menu Pengaturan untuk mengaktifkan Whisper AI.',
    };
  }

  if (!audioBlob || audioBlob.size === 0) {
    return {
      success: false,
      error: 'Rekaman audio kosong atau tidak terdeteksi.',
    };
  }

  // Auto detect provider if mismatched
  const provider = detectProviderFromKey(settings.apiKey) || settings.provider;
  const langCode = language.startsWith('id') ? 'id' : 'en';

  try {
    if (provider === 'groq') {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('language', langCode);
      formData.append('response_format', 'json');

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey.trim()}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `Groq Whisper error: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, result: data.text?.trim() };
    } else if (provider === 'openai') {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-1');
      formData.append('language', langCode);

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey.trim()}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `OpenAI Whisper error: ${response.status}`);
      }

      const data = await response.json();
      return { success: true, result: data.text?.trim() };
    } else if (provider === 'gemini') {
      const base64Audio = await blobToBase64(audioBlob);
      const text = await callGeminiAudio(settings.apiKey.trim(), base64Audio, audioBlob.type || 'audio/webm');
      return { success: true, result: text };
    }

    return {
      success: false,
      error: 'Provider AI tidak didukung untuk transkripsi audio.',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Gagal memproses audio dengan Whisper AI.',
    };
  }
}

/**
 * Main AI text operations dispatcher
 */
export async function executeAITask(
  settings: AISettings,
  taskType: 'polish' | 'summarize' | 'actions' | 'speakers',
  transcriptText: string
): Promise<AIResponse> {
  if (!settings.apiKey || !settings.apiKey.trim()) {
    return {
      success: false,
      error: 'API Key belum diisi. Silakan masukkan API Key di menu Pengaturan.',
    };
  }

  if (!transcriptText || !transcriptText.trim()) {
    return {
      success: false,
      error: 'Teks transkrip masih kosong untuk diproses oleh AI.',
    };
  }

  // Auto detect provider if mismatched
  const provider = detectProviderFromKey(settings.apiKey) || settings.provider;

  let promptInstruction = '';
  if (taskType === 'speakers') {
    promptInstruction = `Kamu adalah asisten analisis transkrip percakapan tingkat tinggi. Tugasmu adalah menganalisis transkrip percakapan berikut dan memisahkan setiap giliran bicara pembicara (Speaker Diarization):
1. Deteksi pergantian orang yang berbicara (dialog tanya-jawab, tanggapan singkat seperti 'Oh oke', 'Heeh itu...', atau peralihan topik).
2. Deteksi nama pembicara jika ada nama orang yang dipanggil atau disebutkan dalam konteks percakapan (misalnya 'Pak Bagus', 'Bu Ayu', 'Mas Arya', dll).
3. Jika nama orang belum bisa dipastikan 100%, gunakan label pembicara yang konsisten seperti:
   **[Pembicara A]** dan **[Pembicara B]** (atau Pembicara 1, Pembicara 2).
4. Tuliskan setiap giliran bicara di baris baru terpisah dengan format:
   **[Nama Pembicara]:** Kalimat yang diucapkan...
5. Perbaiki tanda baca agar kalimatnya rapi dan enak dibaca.
6. JANGAN tambahkan penjelasan atau kata pengantar apapun, langsung keluarkan hasil dialog yang sudah dipisah.`;
  } else if (taskType === 'polish') {
    promptInstruction = `Kamu adalah asisten editor transkrip profesional. Tugasmu adalah merapikan transkrip suara lisan berikut:
1. Tambahkan tanda baca yang tepat (titik, koma, tanda tanya, huruf kapital).
2. Perbaiki kesalahan pengetikan lisan (typo / slip of tongue, seperti 'rewok' menjadi 'rework') dengan memahami konteks percakapan secara cerdas.
3. Pisahkan menjadi paragraf-paragraf yang rapi dan mudah dibaca.
4. JANGAN tambahkan penjelasan atau kata pengantar apapun, langsung keluarkan hasil transkrip yang sudah rapi.`;
  } else if (taskType === 'summarize') {
    promptInstruction = `Kamu adalah asisten notulensi profesional. Berikan ringkasan eksekutif yang terstruktur dan padat dari transkrip berikut:
1. Buat paragraf ringkasan umum (Overview).
2. Buat poin-poin utama yang dibahas (Key Highlights).
3. Gunakan Bahasa Indonesia yang jelas, profesional, dan to-the-point.`;
  } else if (taskType === 'actions') {
    promptInstruction = `Kamu adalah asisten manajemen proyek. Dari transkrip berikut, ekstrak seluruh:
1. Daftar Tugas / Action Items yang harus dikerjakan (sertakan penanggung jawab jika disebutkan).
2. Keputusan penting (Key Decisions) yang disepakati.
3. Gunakan format checklist yang rapi (misal: - [ ] Tugas...). Jika tidak ada tugas eksplisit, tuliskan simpulan tindak lanjut logis.`;
  }

  const fullPrompt = `${promptInstruction}\n\n--- TEKS TRANSKRIP ---\n${transcriptText}`;

  try {
    let resultText = '';
    if (provider === 'gemini') {
      const model = settings.customModel || 'gemini-1.5-flash';
      resultText = await callGemini(settings.apiKey.trim(), fullPrompt, model);
    } else if (provider === 'groq') {
      const model = settings.customModel || 'llama-3.3-70b-versatile';
      resultText = await callOpenAICompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        settings.apiKey.trim(),
        model,
        'Kamu adalah asisten cerdas pemrosesan transkrip dialog.',
        fullPrompt
      );
    } else if (provider === 'openai') {
      const model = settings.customModel || 'gpt-4o-mini';
      resultText = await callOpenAICompatible(
        'https://api.openai.com/v1/chat/completions',
        settings.apiKey.trim(),
        model,
        'Kamu adalah asisten cerdas pemrosesan transkrip dialog.',
        fullPrompt
      );
    }

    return { success: true, result: resultText };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Terjadi kesalahan saat memproses permintaan AI.',
    };
  }
}
