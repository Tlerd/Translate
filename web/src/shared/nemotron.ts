export const NEMOTRON_MODEL = 'nvidia/nemotron-3.5-asr-streaming-0.6b';
// NVIDIA's 32 transcription-ready / broad-coverage locales. The eight
// adaptation-ready locales require fine-tuning and are deliberately omitted.
// https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
export const NEMOTRON_LOCALES = `en-US en-GB es-US es-ES fr-FR fr-CA it-IT pt-BR pt-PT nl-NL de-DE tr-TR ru-RU ar-AR hi-IN ja-JP ko-KR vi-VN uk-UA pl-PL sv-SE cs-CZ nb-NO da-DK bg-BG fi-FI hr-HR sk-SK zh-CN hu-HU ro-RO et-EE`.split(' ');
