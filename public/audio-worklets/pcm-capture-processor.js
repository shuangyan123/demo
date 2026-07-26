/** 将麦克风 Float32 音频重采样为 16kHz Int16 PCM，每约 100ms 发送一块。 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.pending = []; this.inputRate = sampleRate; }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    const ratio = this.inputRate / 16000;
    for (let index = 0; index < input.length; index += ratio) this.pending.push(Math.max(-1, Math.min(1, input[Math.floor(index)])));
    if (this.pending.length >= 1600) {
      const pcm = new Int16Array(this.pending.splice(0, 1600).map((value) => value < 0 ? value * 0x8000 : value * 0x7fff));
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
