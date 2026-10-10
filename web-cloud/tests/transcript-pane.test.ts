import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TranscriptPane } from '@/features/recording/transcript-pane';
import type { CaptionItem } from '@/shared/recording';

const caption: CaptionItem = {
  id: 1, recordingId: 'fixture', blockId: 1, startMs: 0, endMs: 100,
  source: 'unfinished words', revision: 1, isFinal: false,
  translation: '', targetSourceRevision: 0, translationModelKey: 'fixture', state: 'streaming',
};

describe('live transcript commitment labels', () => {
  it('shows listening while provisional speech is visible and has no translation', () => {
    const html = renderToStaticMarkup(createElement(TranscriptPane, { captions: [caption] }));
    expect(html).toContain('unfinished words');
    expect(html).toContain('Đang nghe...');
    expect(html).not.toContain('Đang dịch...');
  });
  it('labels a previous translation as outdated while a source correction is being translated', () => {
    const html = renderToStaticMarkup(createElement(TranscriptPane, { captions: [{
      ...caption, isFinal: true, source: 'I cannot attend', revision: 2,
      translation: 'Tôi có thể tham dự', targetSourceRevision: 1,
    }] }));
    expect(html).toContain('Đang dịch...');
    expect(html).toContain('Bản dịch cũ — lời gốc đã được chỉnh sửa');
  });
});
