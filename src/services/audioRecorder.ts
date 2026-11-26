/**
 * Lightweight Continuous Audio Recorder Service
 * - Uses a SINGLE MediaRecorder (zero ping-pong slicing overhead) to record the full conversation cleanly
 * - Disables echoCancellation & noiseSuppression so both microphone voice and speaker meeting voices are captured clearly
 * - Exposes live microphone MediaStream (for Deepgram WebSocket streaming) and real-time audio level metering
 */
export class AudioRecorderService {
  private masterRecorder: MediaRecorder | null = null;
  private masterChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private mimeType: string = '';

  // Precise Active Recording Elapsed Timer (excludes paused time)
  private accumulatedActiveMs: number = 0;
  private lastResumeTimestamp: number = 0;
  private isActivelyRecording: boolean = false;

  // Audio Analysis for Live Mic Level Indicator
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;

  public static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'mediaDevices' in navigator &&
      typeof window.MediaRecorder !== 'undefined'
    );
  }

  public getStream(): MediaStream | null {
    return this.stream;
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
   * Returns a playable Blob of the entire conversation recorded.
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

  public async start(): Promise<MediaStream> {
    this.masterChunks = [];
    this.accumulatedActiveMs = 0;
    this.lastResumeTimestamp = Date.now();
    this.isActivelyRecording = true;

    if (!this.stream || !this.stream.active) {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Disable echoCancellation & noiseSuppression so voices from speakers (e.g. Zoom/Meet) and soft voices are NOT muted
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    }

    this.mimeType = this.getSupportedMimeType();
    const recOptions = this.mimeType ? { mimeType: this.mimeType } : undefined;
    this.masterRecorder = new MediaRecorder(this.stream, recOptions);

    this.masterRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.masterChunks.push(event.data);
      }
    };

    // Single lightweight recorder writing 1-second clusters
    this.masterRecorder.start(1000);

    // Lightweight AudioContext solely for the red mic volume level visualizer
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
        this.analyser.fftSize = 256;
        this.analyser.smoothingTimeConstant = 0.6;
        source.connect(this.analyser);
      }
    } catch (err) {
      console.warn('AudioContext visualizer setup warning:', err);
    }

    return this.stream;
  }

  public async pause(): Promise<void> {
    if (this.isActivelyRecording && this.lastResumeTimestamp > 0) {
      this.accumulatedActiveMs += Date.now() - this.lastResumeTimestamp;
      this.lastResumeTimestamp = 0;
      this.isActivelyRecording = false;
    }

    if (this.masterRecorder && this.masterRecorder.state === 'recording') {
      try {
        this.masterRecorder.pause();
      } catch {}
    }
  }

  public resume(): void {
    if (!this.stream || !this.stream.active) return;
    this.lastResumeTimestamp = Date.now();
    this.isActivelyRecording = true;

    if (this.masterRecorder && this.masterRecorder.state === 'paused') {
      try {
        this.masterRecorder.resume();
      } catch {}
    }
  }

  public async stop(): Promise<Blob | null> {
    if (this.isActivelyRecording && this.lastResumeTimestamp > 0) {
      this.accumulatedActiveMs += Date.now() - this.lastResumeTimestamp;
      this.lastResumeTimestamp = 0;
      this.isActivelyRecording = false;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
      this.analyser = null;
    }

    const fullBlob = await new Promise<Blob | null>((resolve) => {
      if (!this.masterRecorder || this.masterRecorder.state === 'inactive') {
        resolve(this.getMasterAudioBlob());
        return;
      }

      this.masterRecorder.onstop = () => {
        resolve(this.getMasterAudioBlob());
      };

      try {
        this.masterRecorder.stop();
      } catch {
        resolve(this.getMasterAudioBlob());
      }
    });

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    return fullBlob;
  }

  public getAudioLevel(): number {
    if (!this.analyser) return 0;

    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    const minBin = 1;
    const maxBin = Math.min(32, dataArray.length);
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
