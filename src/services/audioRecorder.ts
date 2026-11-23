export interface AudioRecorderOptions {
  onChunkReady?: (audioBlob: Blob) => void;
  silenceThresholdMs?: number;
  minChunkDurationMs?: number;
  maxChunkDurationMs?: number;
  hardLimitDurationMs?: number;
  enableVAD?: boolean;
}

export class AudioRecorderService {
  private mediaRecorder: MediaRecorder | null = null;
  private currentChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private mimeType: string = '';
  private isCutting: boolean = false;

  // Audio Analysis for Silence Detection (VAD) & Level Metering
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: any = null;
  private lastSpokeTime: number = 0;
  private chunkStartTime: number = 0;
  private spokenFramesCount: number = 0;
  private hasSpokenInCurrentChunk: boolean = false;
  private options: AudioRecorderOptions;

  constructor(options: AudioRecorderOptions = {}) {
    this.options = {
      silenceThresholdMs: 950,   // ~0.95s natural pause after speaking
      minChunkDurationMs: 3200,  // minimum 3.2s context before cutting on pause
      maxChunkDurationMs: 9000,  // at 9s, cut on any brief 350ms breath pause
      hardLimitDurationMs: 14000, // hard cut at 14s for continuous fast speakers
      enableVAD: true,
      ...options,
    };
  }

  public setOnChunkReady(callback: (audioBlob: Blob) => void): void {
    this.options.onChunkReady = callback;
  }

  public static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'mediaDevices' in navigator &&
      typeof window.MediaRecorder !== 'undefined'
    );
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

  private createAndStartRecorder(targetChunks: Blob[]): MediaRecorder | null {
    if (!this.stream || !this.stream.active) return null;
    const recOptions = this.mimeType ? { mimeType: this.mimeType } : undefined;
    const recorder = new MediaRecorder(this.stream, recOptions);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        targetChunks.push(event.data);
      }
    };

    // 250ms timeslice for low-latency chunk assembly
    recorder.start(250);
    return recorder;
  }

  public async start(): Promise<void> {
    this.currentChunks = [];
    this.spokenFramesCount = 0;
    this.hasSpokenInCurrentChunk = false;
    this.lastSpokeTime = Date.now();
    this.chunkStartTime = Date.now();
    this.isCutting = false;

    if (!this.stream || !this.stream.active) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          // Disable aggressive noise suppression so softer voices / distant speakers aren't filtered out
          noiseSuppression: false,
          // Enable autoGainControl so quiet speech is automatically boosted
          autoGainControl: true,
          channelCount: 1,
        },
      });
    }

    this.mimeType = this.getSupportedMimeType();
    this.mediaRecorder = this.createAndStartRecorder(this.currentChunks);

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

            // Focus analysis on the human fundamental + formant voice frequency band (~100Hz to ~3500Hz)
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

            // Voice activity threshold tuned for high sensitivity while ignoring desk clicks
            if (effectiveEnergy > 13) {
              this.spokenFramesCount++;
              this.lastSpokeTime = now;
              // Require at least ~240ms (2-3 frames) of vocal energy to count as real speech
              if (this.spokenFramesCount >= 2) {
                this.hasSpokenInCurrentChunk = true;
              }
            }

            const silenceDuration = now - this.lastSpokeTime;

            // Condition 1: Natural sentence pause after at least minChunkDurationMs (3.2s)
            const isNaturalPause =
              this.hasSpokenInCurrentChunk &&
              chunkDuration >= (this.options.minChunkDurationMs || 3200) &&
              silenceDuration >= (this.options.silenceThresholdMs || 950);

            // Condition 2: Soft pause (350ms breath) once chunk reaches maxChunkDurationMs (9s)
            const isMaxDuration =
              this.hasSpokenInCurrentChunk &&
              chunkDuration >= (this.options.maxChunkDurationMs || 9000) &&
              silenceDuration >= 350;

            // Condition 3: Hard limit (14s) for non-stop speaking
            const isHardLimit =
              this.hasSpokenInCurrentChunk &&
              chunkDuration >= (this.options.hardLimitDurationMs || 14000);

            // Reset timer on long pure-silence windows so chunkDuration doesn't artificially inflate before speech begins
            if (!this.hasSpokenInCurrentChunk && chunkDuration > 5000 && silenceDuration > 2500) {
              if (this.currentChunks.length > 25) {
                // Periodically recycle silent buffer to prevent memory buildup during long pauses
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

  /**
   * Recycles the MediaRecorder silently if there has been long silence without speech,
   * keeping memory footprint near zero and ensuring the next utterance starts fresh.
   */
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

    try {
      this.mediaRecorder = this.createAndStartRecorder(newChunks);
      oldRecorder.onstop = () => {
        this.isCutting = false;
      };
      oldRecorder.stop();
    } catch {
      this.isCutting = false;
    }
  }

  /**
   * Zero-Gap Ping-Pong Slicing:
   * Starts the NEXT MediaRecorder on the active stream BEFORE stopping the current one,
   * guaranteeing 0ms audio loss between sentence chunks and producing a 100% valid WebM container.
   */
  public async cutUtterance(): Promise<Blob | null> {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive' || this.isCutting) {
      return null;
    }

    this.isCutting = true;
    const oldRecorder = this.mediaRecorder;
    const capturedChunks = this.currentChunks;
    const hadSpeech = this.hasSpokenInCurrentChunk;

    // 1. Immediately spin up the next recorder on the active stream (0ms gap!)
    const nextChunks: Blob[] = [];
    this.currentChunks = nextChunks;
    this.spokenFramesCount = 0;
    this.hasSpokenInCurrentChunk = false;
    this.chunkStartTime = Date.now();
    this.lastSpokeTime = Date.now();

    try {
      if (this.stream && this.stream.active) {
        this.mediaRecorder = this.createAndStartRecorder(nextChunks);
      }
    } catch (err) {
      console.warn('Error starting ping-pong MediaRecorder:', err);
    }

    // 2. Now safely stop the previous recorder to finalize its WebM EBML container
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
        // Ignore tiny blobs (< 1.8 KB) which are just container headers
        resolve(utteranceBlob.size > 1800 ? utteranceBlob : null);
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
    const blob = await this.cutUtterance();
    if (blob && this.options.onChunkReady) {
      this.options.onChunkReady(blob);
    }
  }

  public pause(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      // If user spoke right before clicking Pause, flush that utterance to Whisper first
      if (this.hasSpokenInCurrentChunk && this.options.onChunkReady) {
        const capturedChunks = this.currentChunks;
        const oldRecorder = this.mediaRecorder;
        this.currentChunks = [];
        this.spokenFramesCount = 0;
        this.hasSpokenInCurrentChunk = false;

        oldRecorder.onstop = () => {
          const slice = new Blob(capturedChunks, { type: this.mimeType || 'audio/webm' });
          if (slice.size > 1800 && this.options.onChunkReady) {
            this.options.onChunkReady(slice);
          }
        };
        try {
          oldRecorder.stop();
        } catch {}
      } else {
        this.mediaRecorder.pause();
      }
    }
  }

  public resume(): void {
    if (!this.stream || !this.stream.active) return;
    this.lastSpokeTime = Date.now();
    this.chunkStartTime = Date.now();

    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
    } else if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
      this.currentChunks = [];
      this.spokenFramesCount = 0;
      this.hasSpokenInCurrentChunk = false;
      this.mediaRecorder = this.createAndStartRecorder(this.currentChunks);
    }
  }

  public async stop(): Promise<Blob | null> {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        if (this.stream) {
          this.stream.getTracks().forEach((track) => track.stop());
          this.stream = null;
        }
        this.currentChunks = [];
        resolve(null);
        return;
      }

      const capturedChunks = this.currentChunks;
      const hadSpeech = this.hasSpokenInCurrentChunk;

      this.mediaRecorder.onstop = () => {
        let finalSlice: Blob | null = null;
        if (capturedChunks.length > 0 && hadSpeech) {
          const blob = new Blob(capturedChunks, {
            type: this.mimeType || 'audio/webm',
          });
          if (blob.size > 1800) {
            finalSlice = blob;
            if (this.options.onChunkReady) {
              this.options.onChunkReady(blob);
            }
          }
        }

        this.currentChunks = [];
        this.spokenFramesCount = 0;
        this.hasSpokenInCurrentChunk = false;
        resolve(finalSlice);
      };

      try {
        this.mediaRecorder.stop();
      } catch {
        resolve(null);
      }

      // Release microphone hardware tracks
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
    });
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
