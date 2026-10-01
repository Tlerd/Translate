import { z } from 'zod';
import type { RecordingItem, CaptionItem, SummaryItem } from './recording';
const text = z.string().max(100000);
const id = z.string().min(1).max(160);
export const cloudRecordingIdSchema = id;
const caption = z.object({ id: z.number().int().nonnegative(), recordingId: id, blockId: z.number(), startMs: z.number().nonnegative(), endMs: z.number().nonnegative(), source: text, revision: z.number(), isFinal: z.boolean(), translation: text, targetSourceRevision: z.number(), translationModelKey: z.string().optional(), state: z.enum(['streaming','done','failed']), error: text.optional(), skipReason: text.optional(), speakerLabel: z.string().max(80).optional(), sourceHistory: z.array(z.object({ text, revision: z.number().int().nonnegative() }).strict()).max(20).optional() }).strict();
const recording = z.object({ id, title: z.string().max(2000), createdAt: z.string(), endedAt: z.string().optional(), mode: z.enum(['lecture','readingPractice']), sourceLanguage: z.string().max(30), targetLanguage: z.string().max(30), state: z.enum(['recording','stopped','interrupted']), durationMs: z.number().nonnegative(), audioState: z.enum(['present','missing','deleted']), audioDeletedAt: z.string().optional(), audioMimeType: z.string().optional(), config: z.object({ translationModelKey: z.string(), summaryModelKey: z.string().optional(), imageModelKey: z.string().optional(), context: text.optional(), glossary: text.optional(), transcriptionMode: z.enum(['verbatim','smart']).optional(), speakerCount: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]).optional() }).strict() }).strict();
const summary = z.object({ id, recordingId: id, sourceHash: z.string(), preset: z.literal('default'), modelKey: z.string(), title: text, overview: text, sections: z.array(z.object({ heading: text, bullets: z.array(text), captionIds: z.array(z.number()) }).strict()), generatedAt: z.string() }).strict();
export const cloudPayloadSchema = z.object({ recording, captions: z.array(caption).max(10000), summaries: z.array(summary).max(100) }).strict().refine(p => p.captions.every(c => c.recordingId === p.recording.id) && p.summaries.every(s => s.recordingId === p.recording.id), 'Recording identities must match');
export const cloudWriteSchema = z.object({ id, expectedVersion: z.number().int().nonnegative(), payload: cloudPayloadSchema.nullable() }).strict().refine(p => p.payload === null || p.id === p.payload.recording.id);
export const cloudRowSchema = z.object({ id, version: z.number().int().positive(), payload: cloudPayloadSchema.nullable() }).strict().refine(row => row.payload === null || row.payload.recording.id === row.id);
export const cloudRowResponseSchema = z.object({ row: cloudRowSchema.nullable() }).strict();
export const cloudRecordingIndexItemSchema = z.object({ id, version: z.number().int().positive() }).strict();
export const cloudRecordingIndexPageSchema = z.object({ items: z.array(cloudRecordingIndexItemSchema).max(500), nextCursor: id.nullable() }).strict();
export interface CloudPayload { recording: RecordingItem; captions: CaptionItem[]; summaries: SummaryItem[] }
export interface CloudRow { id: string; version: number; payload: CloudPayload | null }
export interface CloudRecordingIndexItem { id: string; version: number }
export interface CloudRecordingIndexPage { items: CloudRecordingIndexItem[]; nextCursor: string | null }
