import { describe, expect, it } from 'vitest';
import { SonioxTranscript } from '@/features/recording/soniox-transcript';

describe('Soniox token snapshots', () => {
  it('replaces interim, appends final once and preserves revision through boundary', () => {
    const transcript = new SonioxTranscript('connection');
    expect(transcript.process({ tokens: [{ text: 'Tôi đang' }] })[0].text).toBe('Tôi đang');
    const second = transcript.process({ tokens: [{ text: 'Tôi đang học' }] })[0];
    expect(second.text).toBe('Tôi đang học');
    expect(second.revision).toBe(2);
    expect(transcript.process({ tokens: [{ text: 'Tôi ', is_final: true }, { text: 'học' }] })[0].isFinal).toBe(false);
    const final = transcript.process({ tokens: [{ text: 'học.', is_final: true }, { text: '<fin>', is_final: true }] })[0];
    expect(final).toMatchObject({ text: 'Tôi học.', isFinal: true, revision: 4, providerItemId: second.providerItemId });
  });
  it('joins Japanese and repeated words without arbitrary spaces, handles multiple boundaries', () => {
    const snapshots = new SonioxTranscript('a').process({ tokens: [
      { text: '日本', is_final: true }, { text: '語です。', is_final: true }, { text: '<end>' },
      { text: 'はい', is_final: true }, { text: 'はい', is_final: true }, { text: '<fin>' },
      { text: '次' },
    ] });
    expect(snapshots.map((snapshot) => snapshot.text)).toEqual(['日本語です。', 'はいはい', '次']);
    expect(new Set(snapshots.map((snapshot) => snapshot.providerItemId)).size).toBe(3);
  });
  it('retracts provisional text but never creates empty captions from markers', () => {
    const transcript = new SonioxTranscript('a');
    expect(transcript.process({ tokens: [{ text: '<fin>' }] })).toEqual([]);
    const first = transcript.process({ tokens: [{ text: '仮' }] })[0];
    expect(transcript.process({ tokens: [] })[0]).toMatchObject({ text: '', providerItemId: first.providerItemId, revision: 2 });
  });
  it('finishes committed text after processing tokens and discards unconfirmed hypotheses', () => {
    const snapshots = new SonioxTranscript('b').process({ tokens: [
      { text: 'đúng', is_final: true, start_ms: 300, end_ms: 500 }, { text: ' đoán' },
    ], finished: true });
    expect(snapshots[0]).toMatchObject({ text: 'đúng', isFinal: true, startMs: 300, endMs: 500 });
    expect(new SonioxTranscript('c').process({ tokens: [{ text: 'guess' }], finished: true })).toEqual([]);
  });

  it('processes parallel original and translation tokens per utterance', () => {
    const transcript = new SonioxTranscript('trans-conn');
    const snapshot1 = transcript.process({
      tokens: [
        { text: 'おはよう', translation_status: 'original' },
        { text: 'Chào buổi sáng', translation_status: 'translation' },
      ],
    })[0];
    expect(snapshot1).toMatchObject({
      text: 'おはよう',
      translation: 'Chào buổi sáng',
      isFinal: false,
    });
    const snapshot2 = transcript.process({
      tokens: [
        { text: 'おはようございます', is_final: true, translation_status: 'original' },
        { text: 'Chào buổi sáng ạ', is_final: true, translation_status: 'translation' },
        { text: '<fin>' },
      ],
    })[0];
    expect(snapshot2).toMatchObject({
      text: 'おはようございます',
      translation: 'Chào buổi sáng ạ',
      isFinal: true,
    });
  });
});
