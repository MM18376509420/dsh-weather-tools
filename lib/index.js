// src/index.ts
import { defineTool } from '@deepseek-ai/dsh-tools';
import { getWeather } from './get_weather.js';
import { calculate } from './calculate.js';
export const name = 'dsh-weather-tools';
export const inject = ['tools'];
export function apply(ctx) {
    // ---- 工具 1：查天气 ----
    ctx.tools.register(defineTool({
        name: 'get_weather',
        description: '查询指定城市的天气',
        parameters: {
            city: { type: 'string', required: true, description: '城市名称' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args) {
            return getWeather(args.city);
        },
    }));
    // ---- 工具 2：计算 ----
    ctx.tools.register(defineTool({
        name: 'calculate',
        description: '计算数学表达式，例如 1+1 或 10*5',
        parameters: {
            expression: { type: 'string', required: true, description: '数学表达式' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args) {
            return calculate(args.expression);
        },
    }));
}
