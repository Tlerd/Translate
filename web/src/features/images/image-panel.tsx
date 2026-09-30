'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Image as ImageIcon, Loader2, Download, AlertCircle } from 'lucide-react';
import { requestImage, fetchModels } from '@/lib/api-client';
import { saveImage, getImage } from '@/storage/recordings';
import type { SummaryItem, ImageItem } from '@/shared/recording';
import type { ModelInfo } from '@/shared/ai-contracts';

interface ImagePanelProps {
  recordingId: string;
  summary?: SummaryItem;
}

export function ImagePanel({ recordingId, summary }: ImagePanelProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableImageModels, setAvailableImageModels] = useState<ModelInfo[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState('google:gemini-3.1-flash-image');
  const currentSummaryHashRef = useRef(summary?.sourceHash);
  currentSummaryHashRef.current = summary?.sourceHash;

  // Only show an image generated from the summary currently on screen.
  useEffect(() => {
    let activeUrl: string | null = null;
    let active = true;
    setImageUrl(null);
    getImage(recordingId).then((img) => {
      if (active && img && img.summaryHash === summary?.sourceHash) {
        const url = URL.createObjectURL(img.blob);
        activeUrl = url;
        setImageUrl(url);
      }
    });

    return () => {
      active = false;
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [recordingId, summary?.sourceHash]);

  useEffect(() => {
    fetchModels()
      .then((res) => {
        const imageModels = res.models.filter((m) => m.allowedTasks.includes('image'));
        setAvailableImageModels(imageModels);
      })
      .catch((err) => console.warn('Lỗi lấy model ảnh:', err));
  }, [recordingId]);

  const handleGenerateImage = async () => {
    if (!summary) {
      alert('Cần có bản tóm tắt trước khi tạo ảnh minh họa.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const requestId = `img_${recordingId}_${Date.now()}`;
      const requestedSourceHash = summary.sourceHash;
      const { blob, modelKey } = await requestImage({
        requestId,
        recordingId,
        summaryId: summary.id,
        sourceHash: summary.sourceHash,
        summaryHash: `hash_${Date.now()}`,
        modelKey: selectedModelKey,
        summary: {
          title: summary.title,
          overview: summary.overview,
          sections: summary.sections.map((s) => ({
            heading: s.heading,
            bullets: s.bullets,
          })),
        },
      });

      if (currentSummaryHashRef.current !== requestedSourceHash) return;

      const newImageItem: ImageItem = {
        id: `img_${recordingId}`,
        recordingId,
        summaryId: summary.id,
        summaryHash: summary.sourceHash,
        modelKey,
        mimeType: 'image/webp',
        blob,
        createdAt: new Date().toISOString(),
      };

      await saveImage(newImageItem);

      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(URL.createObjectURL(blob));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!imageUrl) return;
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `minh_hoa_${recordingId}.webp`;
    a.click();
  };

  if (!summary) {
    return (
      <div
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
        }}
      >
        Tạo ảnh minh họa khả dụng sau khi bạn bấm <strong>Tóm tắt</strong> ở tab bên trên.
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 20,
        padding: '16px',
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ImageIcon size={18} color="var(--accent)" />
          <h4 style={{ fontSize: '0.95rem', fontWeight: 600 }}>Ảnh Minh Họa Bài Học</h4>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={selectedModelKey}
            onChange={(e) => setSelectedModelKey(e.target.value)}
            disabled={loading}
            style={{
              padding: '6px 10px',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              color: 'var(--text-primary)',
            }}
          >
            {availableImageModels.length > 0 ? (
              availableImageModels.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} {!m.configured ? '(Chưa có key)' : ''}
                </option>
              ))
            ) : (
              <>
                <option value="google:gemini-3.1-flash-image">Gemini 3.1 Flash Image (Google)</option>
                <option value="openai:gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst (OpenAI)</option>
              </>
            )}
          </select>

          <button
            onClick={handleGenerateImage}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              backgroundColor: 'var(--bg-active)',
              color: '#fff',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.82rem',
              fontWeight: 600,
            }}
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Đang tạo ảnh...</span>
              </>
            ) : (
              <>
                <ImageIcon size={14} />
                <span>{imageUrl ? 'Tạo ảnh khác' : 'Tạo ảnh'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--danger)',
            fontSize: '0.85rem',
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {imageUrl && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt="Minh họa bài học"
            style={{
              maxWidth: '100%',
              maxHeight: 480,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-color)',
              objectFit: 'contain',
            }}
          />

          <button
            onClick={handleDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              backgroundColor: 'var(--bg-hover)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              color: 'var(--text-primary)',
            }}
          >
            <Download size={14} />
            <span>Tải ảnh về máy</span>
          </button>
        </div>
      )}
    </div>
  );
}
