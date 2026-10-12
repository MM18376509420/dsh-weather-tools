// src/calculate.ts
export function calculate(expression) {
    const allowed = new Set('0123456789+-*/(). ');
    if (![...expression].every(c => allowed.has(c))) {
        return '错误：表达式包含非法字符';
    }
    try {
        // 注意：这里用 Function 是为了演示，生产环境请换成安全求值库
        const result = Function(`"use strict"; return (${expression})`)();
        return `${expression} = ${result}`;
    }
    catch (e) {
        return `计算错误：${String(e)}`;
    }
}
