import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
/**
 * 提交一个音频文件到 OpenAI 兼容的转写端点。
 * @param request - 端点、文件与识别参数。
 * @returns 规范化后的转写结果。
 */
export async function transcribe(request) {
    const bytes = await readFile(request.file, { signal: request.signal });
    const form = new FormData();
    // 第三参数是文件名：服务端靠扩展名判断容器格式，省略会被 400。
    form.set('file', new Blob([bytes]), basename(request.file));
    form.set('model', request.model);
    // 词级时间戳只在 verbose_json 下返回。
    form.set('response_format', request.wordTimestamps ? 'verbose_json' : 'json');
    if (request.wordTimestamps)
        form.set('word_timestamps', 'true');
    if (request.language !== undefined && request.language.length > 0)
        form.set('language', request.language);
    if (request.prompt !== undefined && request.prompt.length > 0)
        form.set('prompt', request.prompt);
    const response = await fetch(request.endpoint, { method: 'POST', body: form, signal: request.signal });
    const body = await response.text();
    if (!response.ok)
        throw new Error(`转写端点返回 ${response.status}：${body.slice(0, 500)}`);
    return parseTranscript(body);
}
/** 窄化校验端点响应；这是外部进程边界，不能直接断言类型。 */
function parseTranscript(body) {
    let payload;
    try {
        payload = JSON.parse(body);
    }
    catch (error) {
        throw new Error(`转写端点返回的不是 JSON：${String(error)}`);
    }
    if (typeof payload !== 'object' || payload === null)
        throw new Error('转写端点返回的 JSON 不是对象');
    const record = payload;
    if (typeof record.text !== 'string')
        throw new Error('转写端点响应缺少字符串字段 text');
    const words = [];
    if (Array.isArray(record.words)) {
        for (const entry of record.words) {
            if (typeof entry !== 'object' || entry === null)
                continue;
            const candidate = entry;
            if (typeof candidate.word !== 'string')
                continue;
            if (typeof candidate.start !== 'number' || typeof candidate.end !== 'number')
                continue;
            words.push({ word: candidate.word, start: candidate.start, end: candidate.end });
        }
    }
    return {
        text: record.text,
        ...typeof record.language === 'string' ? { language: record.language } : {},
        ...typeof record.duration === 'number' ? { duration: record.duration } : {},
        words,
    };
}
