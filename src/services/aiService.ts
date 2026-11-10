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
 * Call Google Gemini API
 */
async function callGemini(apiKey: string, prompt: string, model: string = 'gemini-1.5-flash'): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

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

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `Gemini API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Tidak ada respon teks dari Gemini.');
  }
  return text.trim();
}

/**
 * Call OpenAI-compatible API (Groq, OpenAI)
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
 * Main AI dispatcher based on settings
 */
export async function executeAITask(
  settings: AISettings,
  taskType: 'polish' | 'summarize' | 'actions',
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

  let promptInstruction = '';
  if (taskType === 'polish') {
    promptInstruction = `Kamu adalah asisten editor transkrip profesional. Tugasmu adalah merapikan transkrip suara lisan berikut:
1. Tambahkan tanda baca yang tepat (titik, koma, tanda tanya, huruf kapital).
2. Perbaiki kesalahan pengetikan lisan (typo / slip of tongue) tanpa mengubah konteks atau makna aslinya.
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
    if (settings.provider === 'gemini') {
      const model = settings.customModel || 'gemini-1.5-flash';
      resultText = await callGemini(settings.apiKey.trim(), fullPrompt, model);
    } else if (settings.provider === 'groq') {
      const model = settings.customModel || 'llama-3.3-70b-versatile';
      resultText = await callOpenAICompatible(
        'https://api.groq.com/openai/v1/chat/completions',
        settings.apiKey.trim(),
        model,
        'Kamu adalah asisten cerdas pemrosesan transkrip.',
        fullPrompt
      );
    } else if (settings.provider === 'openai') {
      const model = settings.customModel || 'gpt-4o-mini';
      resultText = await callOpenAICompatible(
        'https://api.openai.com/v1/chat/completions',
        settings.apiKey.trim(),
        model,
        'Kamu adalah asisten cerdas pemrosesan transkrip.',
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
