export type ChunkReadyCallback = (
  audioBlob: Blob,
  startSec: number,
  endSec: number
) => void;

export interface AudioRecorderOptions {
  onChunkReady?: ChunkReadyCallback;
  silenceThresholdMs?: number;
  minChunkDurationMs?: number;
  maxChunkDurationMs?: number;
  hardLimitDurationMs?: number;
  enableVAD?: boolean;
}

export class AudioRecorderService {
  // Continuous Master Recorder (for seamless full-conversation playback & seeking)
  private masterRecorder: MediaRecorder | null = null;
  private masterChunks: Blob[] = [];

  // Utterance Slicer Recorder (Zero-Gap Ping-Pong for real-time Whisper AI)
  private mediaRecorder: MediaRecorder | null = null;
  private currentChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private mimeType: string = '';
  private isCutting: boolean = false;

  // Precise Active Recording Elapsed Timer (excludes paused time)
  private accumulatedActiveMs: number = 0;
  private lastResumeTimestamp: number = 0;
  private isActivelyRecording: boolean = false;

  // Audio Analysis for Silence Detection (VAD) & Level Metering
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: any = null;
  private lastSpokeTime: number = 0;
  private chunkStartTime: number = 0;
  private chunkStartElapsedSec: number = 0;
  private firstSpeechElapsedSec: number | null = null;
  private spokenFramesCount: number = 0;
  private hasSpokenInCurrentChunk: boolean = false;
  private options: AudioRecorderOptions;

  constructor(options: AudioRecorderOptions = {}) {
    this.options = {
      silenceThresholdMs: 950,    // ~0.95s natural pause after speaking
      minChunkDurationMs: 3200,   // minimum 3.2s context before cutting on pause
      maxChunkDurationMs: 9000,   // at 9s, cut on any brief 350ms breath pause
      hardLimitDurationMs: 14000, // hard cut at 14s for continuous fast speakers
      enableVAD: true,
      ...options,
    };
  }

  public setOnChunkReady(callback: ChunkReadyCallback): void {
    this.options.onChunkReady = callback;
  }

  public static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'mediaDevices' in navigator &&
      typeof window.MediaRecorder !== 'undefined'
    );
  }

  /**
   * Returns exact elapsed active recording duration in seconds (with 0.1s precision).
   */
  public getElapsedSeconds(): number {
    let totalMs = this.accumulatedActiveMs;
    if (this.isActivelyRecording && this.lastResumeTimestamp > 0) {
      totalMs += Date.now() - this.lastResumeTimestamp;
    }
    return Math.max(0, Number((totalMs / 1000).toFixed(1)));
  }

  /**
   * Returns a playable Blob of the entire conversation recorded so far (works both while paused and after stopping).
   */
  public getMasterAudioBlob(): Blob | null {
    if (this.masterChunks.length === 0) return null;
    const blob = new Blob(this.masterChunks, {
      type: this.mimeType || 'audio/webm',
    });
    return blob.size > 1000 ? blob : null;
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/aac',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        return type;
      }
    }
    return '';
  }

  private createAndStartRecorder(targetChunks: Blob[], timesliceMs: number = 250): MediaRecorder | null {
    if (!this.stream || !this.stream.active) return null;
    const recOptions = this.mimeType ? { mimeType: this.mimeType } : undefined;
    const recorder = new MediaRecorder(this.stream, recOptions);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        targetChunks.push(event.data);
      }
    };

    recorder.start(timesliceMs);
    return recorder;
  }

  public async start(): Promise<void> {
    this.masterChunks = [];
    this.currentChunks = [];
    this.spokenFramesCount = 0;
    this.hasSpokenInCurrentChunk = false;
    this.accumulatedActiveMs = 0;
    this.lastResumeTimestamp = Date.now();
    this.isActivelyRecording = true;
    this.lastSpokeTime = Date.now();
    this.chunkStartTime = Date.now();
    this.chunkStartElapsedSec = 0;
    this.firstSpeechElapsedSec = null;
    this.isCutting = false;

    if (!this.stream || !this.stream.active) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    }

    this.mimeType = this.getSupportedMimeType();

    // 1. Start continuous master recorder for full-session playback
    this.masterRecorder = this.createAndStartRecorder(this.masterChunks, 500);

    // 2. Start utterance slicer recorder for live Whisper chunks
    this.mediaRecorder = this.createAndStartRecorder(this.currentChunks, 250);

    // Setup Audio Analysis for Voice Activity Detection (VAD)
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        if (!this.audioContext || this.audioContext.state === 'closed') {
          this.audioContext = new AudioCtx();
        } else if (this.audioContext.state === 'suspended') {
          await this.audioContext.resume().catch(() => {});
        }

        const source = this.audioContext.createMediaStreamSource(this.stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.6;
        source.connect(this.analyser);

        if (this.vadInterval) {
          clearInterval(this.vadInterval);
        }

        if (this.options.enableVAD) {
          const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

          this.vadInterval = setInterval(() => {
            if (
              !this.analyser ||
              !this.mediaRecorder ||
              this.mediaRecorder.state !== 'recording' ||
              this.isCutting
            ) {
              return;
            }

            if (this.audioContext && this.audioContext.state === 'suspended') {
              this.audioContext.resume().catch(() => {});
            }

            this.analyser.getByteFrequencyData(dataArray);

            const minBin = 2;
            const maxBin = Math.min(42, dataArray.length);
            let voiceSum = 0;
            let peakBin = 0;
            for (let i = minBin; i < maxBin; i++) {
              const val = dataArray[i];
              voiceSum += val;
              if (val > peakBin) peakBin = val;
            }
            const avgVoiceVolume = voiceSum / (maxBin - minBin);
            const effectiveEnergy = avgVoiceVolume * 0.75 + peakBin * 0.25;

            const now = Date.now();
            const chunkDuration = now - this.chunkStartTime;

            if (effectiveEnergy > 13) {
              this.spokenFramesCount++;
              this.lastSpokeTime = now;
              if (this.firstSpeechElapsedSec === null) {
                // Record timestamp with 0.25s pre-roll so initial consonant is never clipped on seek
                this.firstSpeechElapsedSec = Math.max(
                  this.chunkStartElapsedSec,
                  Number((this.getElapsedSeconds() - 0.25).toFixed(1))
                );
              }
              if (this.spokenFramesCount >= 2) {
                this.hasSpokenInCurrentChunk = true;
              }
            }

            const silenceDuration = now - this.lastSpokeTime;

            const isNaturalPause =
              this.hasSpokenInCurrentChunk &&
              chunkDuration >= (this.options.minChunkDurationMs || 3200) &&
              silenceDuration >= (this.options.silenceThresholdMs || 950);

            const isMaxDuration =
              this.hasSpokenInCurrentChunk &&
              chunkDuration >= (this.options.maxChunkDurationMs || 9000) &&
              silenceDuration >= 350;

            const isHardLimit =
              this.hasSpokenInCurrentChunk &&
              chunkDuration >= (this.options.hardLimitDurationMs || 14000);

            if (!this.hasSpokenInCurrentChunk && chunkDuration > 5000 && silenceDuration > 2500) {
              if (this.currentChunks.length > 25) {
                this.recycleSilentRecorder();
              }
            } else if ((isNaturalPause || isMaxDuration || isHardLimit) && this.options.onChunkReady) {
              this.sliceAndEmitCurrentChunk();
            }
          }, 120);
        }
      }
    } catch (err) {
      console.warn('AudioContext setup error (VAD disabled):', err);
    }
  }

  private recycleSilentRecorder(): void {
    if (this.isCutting || !this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
    this.isCutting = true;
    const oldRecorder = this.mediaRecorder;
    const newChunks: Blob[] = [];
    this.currentChunks = newChunks;
    this.spokenFramesCount = 0;
    this.hasSpokenInCurrentChunk = false;
    this.chunkStartTime = Date.now();
    this.lastSpokeTime = Date.now();
    this.chunkStartElapsedSec = this.getElapsedSeconds();
    this.firstSpeechElapsedSec = null;

    try {
      this.mediaRecorder = this.createAndStartRecorder(newChunks, 250);
      oldRecorder.onstop = () => {
        this.isCutting = false;
      };
      oldRecorder.stop();
    } catch {
      this.isCutting = false;
    }
  }

  /**
   * Zero-Gap Ping-Pong Slicing for Utterance Recorder (while Master Recorder stays continuous).
   */
  public async cutUtterance(): Promise<{
    blob: Blob;
    startSec: number;
    endSec: number;
  } | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive' || this.isCutting) {
      return null;
    }

    this.isCutting = true;
    const oldRecorder = this.mediaRecorder;
    const capturedChunks = this.currentChunks;
    const hadSpeech = this.hasSpokenInCurrentChunk;
    const nowElapsedSec = this.getElapsedSeconds();
    const startSec =
      this.firstSpeechElapsedSec !== null ? this.firstSpeechElapsedSec : this.chunkStartElapsedSec;
    const endSec = Math.max(startSec + 0.5, nowElapsedSec);

    // 1. Immediately spin up the next utterance recorder on the active stream (0ms gap!)
    const nextChunks: Blob[] = [];
    this.currentChunks = nextChunks;
    this.spokenFramesCount = 0;
    this.hasSpokenInCurrentChunk = false;
    this.chunkStartTime = Date.now();
    this.lastSpokeTime = Date.now();
    this.chunkStartElapsedSec = nowElapsedSec;
    this.firstSpeechElapsedSec = null;

    try {
      if (this.stream && this.stream.active) {
        this.mediaRecorder = this.createAndStartRecorder(nextChunks, 250);
      }
    } catch (err) {
      console.warn('Error starting ping-pong MediaRecorder:', err);
    }

    // 2. Finalize the previous utterance recorder
    return new Promise((resolve) => {
      oldRecorder.onstop = () => {
        this.isCutting = false;
        if (!hadSpeech || capturedChunks.length === 0) {
          resolve(null);
          return;
        }
        const utteranceBlob = new Blob(capturedChunks, {
          type: this.mimeType || 'audio/webm',
        });
        resolve(
          utteranceBlob.size > 1800
            ? { blob: utteranceBlob, startSec, endSec }
            : null
        );
      };

      try {
        oldRecorder.stop();
      } catch (err) {
        this.isCutting = false;
        console.warn('Error stopping previous MediaRecorder in cutUtterance:', err);
        resolve(null);
      }
    });
  }

  private async sliceAndEmitCurrentChunk(): Promise<void> {
    const result = await this.cutUtterance();
    if (result && this.options.onChunkReady) {
      this.options.onChunkReady(result.blob, result.startSec, result.endSec);
    }
  }

  public async pause(): Promise<Blob | null> {
    if (this.isActivelyRecording && this.lastResumeTimestamp > 0) {
      this.accumulatedActiveMs += Date.now() - this.lastResumeTimestamp;
      this.lastResumeTimestamp = 0;
      this.isActivelyRecording = false;
    }

    // Pause continuous master recorder and flush latest data so audio is playable during pause
    if (this.masterRecorder && this.masterRecorder.state === 'recording') {
      try {
        this.masterRecorder.requestData();
        this.masterRecorder.pause();
      } catch {}
    }

    // Flush any spoken utterance chunk to Whisper
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      if (this.hasSpokenInCurrentChunk && this.options.onChunkReady) {
        const capturedChunks = this.currentChunks;
        const oldRecorder = this.mediaRecorder;
        const endSec = this.getElapsedSeconds();
        const startSec =
          this.firstSpeechElapsedSec !== null
            ? this.firstSpeechElapsedSec
            : this.chunkStartElapsedSec;

        this.currentChunks = [];
        this.spokenFramesCount = 0;
        this.hasSpokenInCurrentChunk = false;
        this.firstSpeechElapsedSec = null;

        oldRecorder.onstop = () => {
          const slice = new Blob(capturedChunks, { type: this.mimeType || 'audio/webm' });
          if (slice.size > 1800 && this.options.onChunkReady) {
            this.options.onChunkReady(slice, startSec, Math.max(startSec + 0.5, endSec));
          }
        };
        try {
          oldRecorder.stop();
        } catch {}
      } else {
        try {
          this.mediaRecorder.pause();
        } catch {}
      }
    }

    // Give requestData a brief 60ms tick to push into masterChunks
    await new Promise((r) => setTimeout(r, 60));
    return this.getMasterAudioBlob();
  }

  public resume(): void {
    if (!this.stream || !this.stream.active) return;
    this.lastResumeTimestamp = Date.now();
    this.isActivelyRecording = true;
    this.lastSpokeTime = Date.now();
    this.chunkStartTime = Date.now();
    this.chunkStartElapsedSec = this.getElapsedSeconds();
    this.firstSpeechElapsedSec = null;

    if (this.masterRecorder && this.masterRecorder.state === 'paused') {
      try {
        this.masterRecorder.resume();
      } catch {}
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      try {
        this.mediaRecorder.resume();
      } catch {}
    } else if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      this.currentChunks = [];
      this.spokenFramesCount = 0;
      this.hasSpokenInCurrentChunk = false;
      this.mediaRecorder = this.createAndStartRecorder(this.currentChunks, 250);
    }
  }

  public async stop(): Promise<Blob | null> {
    if (this.isActivelyRecording && this.lastResumeTimestamp > 0) {
      this.accumulatedActiveMs += Date.now() - this.lastResumeTimestamp;
      this.lastResumeTimestamp = 0;
      this.isActivelyRecording = false;
    }

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    const endSec = this.getElapsedSeconds();
    const startSec =
      this.firstSpeechElapsedSec !== null ? this.firstSpeechElapsedSec : this.chunkStartElapsedSec;

    // 1. Stop utterance slicer recorder and emit final spoken slice if any
    const utteranceStopPromise = new Promise<void>((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        this.currentChunks = [];
        resolve();
        return;
      }

      const capturedChunks = this.currentChunks;
      const hadSpeech = this.hasSpokenInCurrentChunk;

      this.mediaRecorder.onstop = () => {
        if (capturedChunks.length > 0 && hadSpeech && this.options.onChunkReady) {
          const blob = new Blob(capturedChunks, {
            type: this.mimeType || 'audio/webm',
          });
          if (blob.size > 1800) {
            this.options.onChunkReady(blob, startSec, Math.max(startSec + 0.5, endSec));
          }
        }
        this.currentChunks = [];
        this.spokenFramesCount = 0;
        this.hasSpokenInCurrentChunk = false;
        resolve();
      };

      try {
        this.mediaRecorder.stop();
      } catch {
        resolve();
      }
    });

    // 2. Stop continuous master recorder and assemble full playable conversation Blob
    const masterStopPromise = new Promise<Blob | null>((resolve) => {
      if (!this.masterRecorder || this.masterRecorder.state === 'inactive') {
        resolve(this.getMasterAudioBlob());
        return;
      }

      this.masterRecorder.onstop = () => {
        const fullBlob = this.getMasterAudioBlob();
        resolve(fullBlob);
      };

      try {
        this.masterRecorder.stop();
      } catch {
        resolve(this.getMasterAudioBlob());
      }
    });

    const [, fullMasterBlob] = await Promise.all([utteranceStopPromise, masterStopPromise]);

    // Release microphone hardware tracks
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    return fullMasterBlob;
  }

  public getAudioLevel(): number {
    if (!this.analyser) return 0;

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    const minBin = 2;
    const maxBin = Math.min(45, dataArray.length);
    let voiceSum = 0;
    let peak = 0;

    for (let i = minBin; i < maxBin; i++) {
      const val = dataArray[i];
      voiceSum += val;
      if (val > peak) peak = val;
    }

    const avgVoice = voiceSum / (maxBin - minBin);
    const combined = avgVoice * 0.7 + peak * 0.3;

    if (combined < 8) return 0;

    const normalized = Math.round(((combined - 8) / (135 - 8)) * 100);
    return Math.max(0, Math.min(100, normalized));
  }
}
