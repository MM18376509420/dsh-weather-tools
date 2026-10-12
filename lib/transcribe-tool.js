import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { transcribe } from './asr.js';
export const Config = z.object({
    endpoint: z.string().required(),
    model: z.string().default('whisper-1'),
    defaultLanguage: z.string(),
    timeoutMs: z.number().default(120_000),
});
export const name = 'transcribe-tool';
export const inject = ['tools'];
/** 把规范化结果渲染成模型可读文本。 */
function renderTranscript(value) {
    const facts = [
        value.language === undefined ? '' : `语言 ${value.language}`,
        value.duration === undefined ? '' : `时长 ${value.duration.toFixed(1)}s`,
    ].filter(fact => fact.length > 0);
    const body = facts.length === 0 ? value.text : `${facts.join('，')}\n${value.text}`;
    if (value.words.length === 0)
        return body;
    return `${body}\n\n词级时间戳：\n${value.words.map(word => `${word.start.toFixed(2)}-${word.end.toFixed(2)} ${word.word}`).join('\n')}`;
}
/**
 * 注册语音转写工具。
 * @param ctx - 插件上下文。
 * @param config - 端点与默认识别参数。
 */
export function apply(ctx, config) {
    ctx.tools.register(defineTool({
        name: 'transcribe_audio',
        description: '把本地音频文件转写为文字，可选返回词级时间戳。',
        parameters: {
            file: { type: 'string', required: true, description: '本地音频文件路径，形如 D:/audio/test.wav' },
            language: { type: 'string', enum: ['zh', 'en', 'ja', 'ko', 'yue'], description: '语言提示，省略用插件默认值' },
            prompt: { type: 'string', description: '术语/上下文提示，用于纠正专有名词' },
            word_timestamps: { type: 'boolean', description: '是否要求词级时间戳，默认 false' },
        },
        timeoutMs: config.timeoutMs,
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    text: { type: 'string', required: true },
                    language: { type: 'string' },
                    duration: { type: 'number' },
                    words: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                word: { type: 'string', required: true },
                                start: { type: 'number', required: true },
                                end: { type: 'number', required: true },
                            },
                        },
                    },
                },
            },
            render: (_args, value) => [{ type: 'text', text: renderTranscript(value) }],
        },
        async execute(args, exec) {
            return transcribe({
                endpoint: config.endpoint,
                model: config.model,
                file: args.file,
                ...args.prompt === undefined ? {} : { prompt: args.prompt },
                ...args.language === undefined
                    ? config.defaultLanguage === undefined ? {} : { language: config.defaultLanguage }
                    : { language: args.language },
                wordTimestamps: args.word_timestamps ?? false,
                signal: exec.signal,
            });
        },
    }));
}
