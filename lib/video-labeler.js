import { fileURLToPath } from 'node:url';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
// import { isRecord, labelVideo } from './video-tagging.js'
import { labelVideo, loadDictionary } from './video-tagging.js';
export const Config = z.object({
    baseURL: z.string().required(),
    apiKey: z.string().required(),
    model: z.string().required(),
    promptId: z.string().required(),
    temperature: z.number().default(0),
    seed: z.number().default(42),
    timeoutMs: z.number().default(600_000),
    dictFile: z.string().default(fileURLToPath(new URL('../dict_data.json', import.meta.url))),
});
export const name = 'video-labeler';
export const inject = ['tools'];
/**
 * 注册视频标签标注工具：向 MiniCPM-V 网关发送视频地址与服务端提示词模板变量，
 * 返回 23 维结构化标签（label/confidence/code），并复刻脚本的容错清洗。
 * @param ctx - 插件上下文。
 * @param config - 网关地址、模型与调用预算。
 */
export function apply(ctx, config) {
    const endpoint = `${config.baseURL.replace(/\/+$/, '')}/chat/completions`;
    ctx.tools.register(defineTool({
        name: 'label_video',
        description: '对视频做多维结构化标签标注（人物、商品、场景、风格、文案等 23 个维度），'
            + '返回 JSON 对象，每个标签含 label、confidence、code 字段。'
            + '提示词由网关侧模板渲染（prompt_id），候选标签字典内置在插件里；'
            + 'video 必须是模型网关可直接拉取的 http(s) 视频地址。',
        parameters: {
            video: { type: 'string', required: true, description: 'http(s) 视频地址，如 http://host/bucket/segment.mp4' },
        },
        timeoutMs: config.timeoutMs,
        output: {
            schema: { type: 'json' },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
        },
        async execute(args, exec) {
            if (!/^https?:\/\//i.test(args.video)) {
                throw new Error('video 必须是 http(s) 视频地址（由模型网关拉取）');
            }
            return labelVideo({
                endpoint,
                apiKey: config.apiKey,
                model: config.model,
                promptId: config.promptId,
                seed: config.seed,
                temperature: config.temperature,
                video: args.video,
                variables: await loadDictionary(config.dictFile),
                signal: AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)]),
            });
        },
    }));
}
