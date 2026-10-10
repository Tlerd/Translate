import {
  ALL_FORMATS, AudioSampleSink, AudioSampleSource, BlobSource, BufferTarget,
  EncodedAudioPacketSource, EncodedPacketSink, Input, Mp4OutputFormat, Output, WebMOutputFormat,
  type EncodedPacket, type InputAudioTrack,
} from 'mediabunny';

export interface AudioPart { blob: Blob; segmentIndex: number }
export interface NormalizedAudio { blob: Blob; durationMs: number; packetCount: number }

// RFC 6716 §3.1: container block durations can be absent or rounded. Opus TOC
// carries the actual number of coded samples, including the final packet.
export function opusPacketDuration(data: Uint8Array): number {
  if (!data.length) throw new Error('Packet Opus rỗng.');
  const config = data[0] >> 3;
  const frameMs = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : [10, 20, 40, 60][config & 3];
  const code = data[0] & 3;
  const count = code === 0 ? 1 : code === 3 ? (data[1] ?? 0) & 63 : 2;
  const seconds = frameMs * count / 1000;
  if (seconds <= 0 || seconds > .12) throw new Error('Thời lượng packet Opus không hợp lệ.');
  return seconds;
}
function description(config: AudioDecoderConfig): Uint8Array {
  const buffer = config.description;
  if (!buffer) return new Uint8Array();
  return ArrayBuffer.isView(buffer) ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : new Uint8Array(buffer);
}
function signature(config: AudioDecoderConfig): string {
  return JSON.stringify([config.codec, config.sampleRate, config.numberOfChannels, [...description(config)]]);
}
function preSkip(config: AudioDecoderConfig): number {
  const bytes = description(config);
  return config.codec === 'opus' && bytes.length >= 12 ? (bytes[10] | bytes[11] << 8) / 48000 : 0;
}
function digestPacket(hash: number, packet: EncodedPacket): number {
  for (const byte of packet.data) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash;
}

/** Remux compressed audio off the UI thread; original Dexie chunks are retained. */
export async function normalizeAudio(parts: AudioPart[]): Promise<NormalizedAudio> {
  if (!parts.length) throw new Error('Không tìm thấy audio trên thiết bị này.');
  const inputs: Input[] = [];
  let output: Output | undefined;
  try {
    const tracks: InputAudioTrack[] = [];
    const configs: AudioDecoderConfig[] = [];
    for (const part of parts) {
      const input = new Input({ source: new BlobSource(part.blob), formats: ALL_FORMATS });
      inputs.push(input);
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new Error('File gốc không có luồng âm thanh đọc được.');
      const config = await track.getDecoderConfig();
      if (!config) throw new Error('Không đọc được cấu hình codec audio.');
      tracks.push(track); configs.push(config);
    }
    const codec = await tracks[0].getCodec();
    if (!codec) throw new Error('Codec audio chưa được hỗ trợ.');
    const needsDecode = configs.some(config => preSkip(config) > 0) || (parts.length > 1 && (codec !== 'opus' || configs.some(config => signature(config) !== signature(configs[0]))));
    const format = codec === 'opus' ? new WebMOutputFormat() : new Mp4OutputFormat();
    const target = new BufferTarget();
    output = new Output({ format, target });
    let duration = 0;
    let count = 0;
    let sourceHash = 2166136261;
    if (needsDecode || (codec !== 'opus' && codec !== 'aac')) {
      // Separate AAC/Opus streams can have independent decoder priming. Decode
      // each stream separately so its delay/padding isn't replayed at joins.
      // Re-encoding keeps the speech bitrate the recorder uses; AAC needs more bits than Opus for the same clarity.
      const source = new AudioSampleSource({ codec: codec === 'opus' ? 'opus' : 'aac', bitrate: codec === 'opus' ? 32_000 : 64_000 });
      output.addAudioTrack(source); await output.start();
      for (const track of tracks) {
        for await (const sample of new AudioSampleSink(track).samples()) {
          sample.setTimestamp(duration);
          duration += sample.duration;
          await source.add(sample);
          sample.close(); count++;
        }
      }
      source.close();
    } else {
      const source = new EncodedAudioPacketSource(codec);
      output.addAudioTrack(source); await output.start();
      for (let index = 0; index < tracks.length; index++) {
        let end = duration;
        for await (const packet of new EncodedPacketSink(tracks[index]).packets()) {
          const packetDuration = codec === 'opus' ? opusPacketDuration(packet.data) : packet.duration > 0 ? packet.duration : 1024 / configs[index].sampleRate;
          const timestamp = codec === 'opus' ? end : packet.timestamp;
          await source.add(packet.clone({ timestamp, duration: packetDuration }), { decoderConfig: configs[index] });
          end = Math.max(end, timestamp + packetDuration);
          sourceHash = digestPacket(sourceHash, packet); count++;
        }
        duration = end;
      }
      source.close();
    }
    if (!count || !Number.isFinite(duration) || duration <= 0) throw new Error('Không xác định được thời lượng audio thực tế.');
    await output.finalize();
    if (!target.buffer) throw new Error('Không tạo được file audio.');
    const blob = new Blob([target.buffer], { type: codec === 'opus' ? 'audio/webm' : 'audio/mp4' });
    const check = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await check.getPrimaryAudioTrack();
      const actual = await track?.computeDuration();
      if (!track || actual === undefined || !Number.isFinite(actual) || Math.abs(actual - duration) > .15) throw new Error('Thời lượng file chuẩn hóa không khớp. Bản gốc được giữ lại.');
      // Matroska computeDuration() can report the timestamp of the last packet
      // when its BlockDuration is absent. The muxer's finite metadata includes
      // the coded tail; validate it against the independently counted samples.
      const metadataDuration = await check.getDurationFromMetadata();
      if (metadataDuration === null || !Number.isFinite(metadataDuration) || metadataDuration <= 0 || Math.abs(metadataDuration - duration) > (codec === 'opus' && !needsDecode ? .01 : .15)) throw new Error('Metadata thời lượng không khớp số mẫu audio. Bản gốc được giữ lại.');
      if (!needsDecode && (codec === 'opus' || codec === 'aac')) {
        let outputHash = 2166136261; let outputCount = 0;
        for await (const packet of new EncodedPacketSink(track).packets()) { outputHash = digestPacket(outputHash, packet); outputCount++; }
        if (outputCount !== count || outputHash !== sourceHash) throw new Error('Audio chuẩn hóa thiếu hoặc lặp packet. Bản gốc được giữ lại.');
      }
      return { blob, durationMs: Math.round(metadataDuration * 1000), packetCount: count };
    } finally { check.dispose(); }
  } catch (error) {
    if (output?.state === 'started') await output.cancel().catch(() => undefined);
    throw error;
  } finally { for (const input of inputs) input.dispose(); }
}
