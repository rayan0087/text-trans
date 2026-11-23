/**
 * Client-Side Audio Chunker & 16kHz Mono Resampler for Long Meeting Recordings.
 * Allows transcribing 1-3+ hour audio files (and files > 25MB) seamlessly by:
 * 1. Decoding the audio file in-browser via Web Audio API.
 * 2. Finding natural silence points near every ~5-minute boundary so words are never cut in half.
 * 3. Downsampling each chunk to 16kHz Mono 16-bit WAV (~9.1 MB per 5 minutes, Whisper's native sample rate).
 */

export interface AudioChunkSegment {
  blob: Blob;
  index: number;
  total: number;
  startSec: number;
  endSec: number;
}

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_DURATION_SEC = 300; // 5 minutes per segment (~9.15 MB at 16kHz mono WAV)
const SILENCE_SEARCH_WINDOW_SEC = 15; // Search +/- 15s around boundary for lowest RMS energy

/**
 * Encodes a mono Float32Array PCM buffer into a standard 16-bit WAV Blob.
 */
function encodeMonoWav(samples: Float32Array, sampleRate: number): Blob {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true);  // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true);  // NumChannels = 1 (Mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true);  // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample = 16

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Finds the sample index with the lowest RMS energy (natural pause between sentences)
 * around a target split time so no word is cut in the middle.
 */
function findBestSilenceSample(
  channelData: Float32Array,
  sampleRate: number,
  targetSec: number
): number {
  const totalSamples = channelData.length;
  const targetSample = Math.floor(targetSec * sampleRate);
  if (targetSample >= totalSamples) return totalSamples;

  const searchRadius = Math.floor(SILENCE_SEARCH_WINDOW_SEC * sampleRate);
  const minSample = Math.max(0, targetSample - searchRadius);
  const maxSample = Math.min(totalSamples, targetSample + searchRadius);

  // Evaluate 250ms windows every 100ms
  const windowSamples = Math.floor(0.25 * sampleRate);
  const stepSamples = Math.floor(0.1 * sampleRate);

  let bestSample = targetSample;
  let lowestRms = Infinity;

  for (let pos = minSample; pos + windowSamples < maxSample; pos += stepSamples) {
    let sumSq = 0;
    for (let i = 0; i < windowSamples; i += 4) {
      const val = channelData[pos + i];
      sumSq += val * val;
    }
    const rms = sumSq / (windowSamples / 4);
    if (rms < lowestRms) {
      lowestRms = rms;
      bestSample = pos + Math.floor(windowSamples / 2);
    }
  }

  return bestSample;
}

/**
 * Splits and resamples an audio File into 16kHz Mono WAV chunks if it exceeds 5 minutes or 20MB.
 * For short files (<= 5 min and <= 20MB), returns the original file as a single segment for instant upload.
 */
export async function splitAudioFileForWhisper(
  file: File,
  onProgress?: (msg: string) => void
): Promise<{ segments: AudioChunkSegment[]; durationSeconds: number }> {
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) {
    return {
      segments: [{ blob: file, index: 0, total: 1, startSec: 0, endSec: 0 }],
      durationSeconds: 0,
    };
  }

  let audioCtx: AudioContext | null = null;
  try {
    if (onProgress) {
      onProgress(`Membaca & menganalisis struktur audio "${file.name}"...`);
    }

    const arrayBuffer = await file.arrayBuffer();
    audioCtx = new AudioCtx();
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const durationSeconds = Math.round(decodedBuffer.duration);

    // Fast path: if audio is <= 5.5 minutes AND file size <= 20 MB, send directly without re-encoding
    if (durationSeconds <= 330 && file.size <= 20 * 1024 * 1024) {
      return {
        segments: [
          {
            blob: file,
            index: 0,
            total: 1,
            startSec: 0,
            endSec: durationSeconds,
          },
        ],
        durationSeconds,
      };
    }

    // Resample entire audio to 16kHz Mono using OfflineAudioContext for fast, uniform processing
    if (onProgress) {
      onProgress(
        `Mengoptimalkan audio (${Math.floor(durationSeconds / 60)} menit) ke 16kHz Mono untuk Whisper AI...`
      );
    }

    const targetLength = Math.ceil(decodedBuffer.duration * TARGET_SAMPLE_RATE);
    const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const resampledBuffer = await offlineCtx.startRendering();
    const monoData = resampledBuffer.getChannelData(0);
    const totalSamples = monoData.length;

    // Determine split boundaries at natural silence points every ~5 minutes
    const splitPoints: number[] = [0];
    let currentSec = CHUNK_DURATION_SEC;

    while (currentSec < decodedBuffer.duration - 30) {
      const splitSample = findBestSilenceSample(monoData, TARGET_SAMPLE_RATE, currentSec);
      splitPoints.push(splitSample);
      currentSec = splitSample / TARGET_SAMPLE_RATE + CHUNK_DURATION_SEC;
    }
    splitPoints.push(totalSamples);

    const totalChunks = splitPoints.length - 1;
    const segments: AudioChunkSegment[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const startSample = splitPoints[i];
      const endSample = splitPoints[i + 1];
      const chunkSamples = monoData.subarray(startSample, endSample);
      const wavBlob = encodeMonoWav(chunkSamples, TARGET_SAMPLE_RATE);
      (wavBlob as any).name = `segment_${i + 1}.wav`;

      segments.push({
        blob: wavBlob,
        index: i,
        total: totalChunks,
        startSec: Math.round(startSample / TARGET_SAMPLE_RATE),
        endSec: Math.round(endSample / TARGET_SAMPLE_RATE),
      });
    }

    return { segments, durationSeconds };
  } catch (err) {
    console.warn('Audio decode/chunking fallback to single file:', err);
    if (file.size > 25 * 1024 * 1024) {
      throw new Error(
        `Format audio tidak dapat dipotong otomatis oleh browser dan ukurannya (${(
          file.size /
          (1024 * 1024)
        ).toFixed(1)} MB) melebihi batas 25 MB. Konversi ke MP3/WAV/M4A terlebih dahulu.`
      );
    }
    return {
      segments: [{ blob: file, index: 0, total: 1, startSec: 0, endSec: 0 }],
      durationSeconds: 0,
    };
  } finally {
    if (audioCtx && audioCtx.state !== 'closed') {
      audioCtx.close().catch(() => {});
    }
  }
}
