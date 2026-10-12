/**
 * 视频标签网关（prompt_id 模板）的协议客户端：请求构造、调用与响应清洗，无 cordis 依赖。
 */
import { readFile } from 'node:fs/promises'

/** 单个标签的三元组结构，与脚本的 tag_item_schema 一致。 */
const TAG_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string', maxLength: 20 },
    confidence: { type: 'number' },
    code: { type: 'string', maxLength: 60, pattern: '^[a-z1-2_]*$' },
  },
  required: ['label', 'confidence', 'code'],
} as const

/** 脚本 response_format 中声明的 23 个标签字段（顺序即 required 顺序）。 */
const TAG_FIELDS = [
  'human_race', 'human_sex', 'human_age_range', 'human_facialfeatures',
  'human_facialexpression', 'product_name', 'product_category1', 'product_category2',
  'product_effect', 'human_actiontype', 'apparel', 'weather', 'tone',
  'marketing_intent', 'emotion_tone', 'persona_style', 'selling_point_type',
  'video_style', 'shooting_environment', 'animation_effect', 'lighting_condition',
  'copywriting', 'video_type',
] as const


/** 组装响应约束 schema：每字段一个标签三元组数组，全部 required。 */
function videoTagsSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const field of TAG_FIELDS) {
    properties[field] = { type: 'array', items: TAG_ITEM_SCHEMA, maxItems: 3 }
  }
  return { type: 'object', additionalProperties: false, properties, required: [...TAG_FIELDS] }
}

interface TagItem {
  label: string
  confidence: number
  code: string
}

/** 判断未知值是否为非 null、非数组的普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 复刻 Python str() 的 repr 形式：字符串带单引号，容器元素以 ", " 连接。 */
function pythonRepr(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return `'${value}'`
  if (Array.isArray(value)) return `[${value.map(pythonRepr).join(', ')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value).map(([key, item]) => `${pythonRepr(key)}: ${pythonRepr(item)}`).join(', ')}}`
  }
  return String(value)
}

/** 复刻脚本的 prompt_vars 构造：{k: str(v).replace("'", "") for k, v in dict_data.items()}。 */
function promptVariablesOf(variables: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(variables)) {
    out[key] = pythonRepr(value).replace(/'/g, '')
  }
  return out
}

/** 生成 6 位随机大小写字母，替代 Python 的 random.choices(string.ascii_letters)。 */
function randomLetters(): string {
  let out = ''
  while (out.length < 6) {
    const roll = Math.floor(Math.random() * 52)
    out += String.fromCharCode(roll < 26 ? 97 + roll : 65 + roll - 26)
  }
  return out
}

/** 复刻脚本的 code 清洗：去中文、空格转下划线、非类目字段去数字，并按脚本规则补齐。 */
function normalizeCode(field: string, raw: unknown): string {
  let code = typeof raw === 'string' ? raw : ''
  code = code.replace(/[\u4e00-\u9fa5]/g, '')
  code = code.replace(/ /g, '_')
  if (field !== 'product_category1' && field !== 'product_category2') code = code.replace(/[0-9]/g, '')
  if (code === field) code = `${code}_${randomLetters()}`
  if (code === `${field}_`) code = `${code}${randomLetters()}`
  if (code.length < 6) code = `${field}_${randomLetters()}`
  return code
}

/** 复刻脚本的 confidence 归一化：字符串去空格后转数，clamp 到 [0,1]，失败取 0。 */
function normalizeConfidence(raw: unknown): number {
  const value = typeof raw === 'string' ? Number.parseFloat(raw.replace(/ /g, '')) : raw
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 复刻脚本的 json_response：剥去 ```json fence 后解析，失败返回空对象。 */
function parseModelJson(text: string): Record<string, unknown> {
  const clean = text.replace(/^```json\s*|\s*```$/gm, '')
  try {
    const data: unknown = JSON.parse(clean)
    return isRecord(data) ? data : {}
  } catch {
    return {}
  }
}

/** 逐字段标准化标签数组，保留脚本对非数组字段不处理的语义。 */
function normalizeTags(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data }
  for (const [field, labels] of Object.entries(data)) {
    if (!Array.isArray(labels)) continue
    const processed: TagItem[] = []
    for (const item of labels) {
      if (typeof item === 'string') {
        processed.push({ label: item, confidence: 0, code: '' })
        continue
      }
      if (!isRecord(item)) continue
      processed.push({
        label: typeof item.label === 'string' ? item.label : '无',
        confidence: normalizeConfidence(item.confidence),
        code: normalizeCode(field, item.code),
      })
    }
    out[field] = processed
  }
  return out
}

/** 从网关响应中取出首个 choice 的文本内容。 */
function readContent(body: unknown): string {
  if (!isRecord(body)) throw new Error('标签网关返回了非对象 JSON')
  const choices = body.choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  const message = isRecord(first) ? first.message : undefined
  if (!isRecord(message) || typeof message.content !== 'string') {
    throw new Error('标签网关响应缺少 choices[0].message.content 文本')
  }
  return message.content
}

/** 把网络层失败补上底层原因，便于诊断连接问题。 */
function describeFetchFailure(error: unknown): Error {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `（${error.cause.message}）` : ''
    return new Error(`调用标签网关失败：${error.message}${cause}`)
  }
  return new Error('调用标签网关失败')
}

/**
 * 从 JSON 文件加载提示词字典（字段名 → 候选标签数组）。
 * @param filePath - 字典 JSON 文件的路径。
 * @returns 字典对象，直接作为 prompt_variables 的原始输入。
 */
export async function loadDictionary(filePath: string): Promise<Record<string, unknown>> {
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (error: unknown) {
    throw new Error(`读取提示词字典失败（${filePath}）：${String(error)}`)
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error(`提示词字典不是合法 JSON（${filePath}）：${String(error)}`)
  }
  if (!isRecord(data)) throw new Error(`提示词字典必须是 JSON 对象（${filePath}）`)
  return data
}


/** 一次视频标签调用请求。 */
export interface LabelVideoRequest {
  /** 完整的 chat/completions 端点 URL。 */
  endpoint: string
  /** 网关 API key。 */
  apiKey: string
  /** 视觉模型 id。 */
  model: string
  /** 服务端提示词模板 id。 */
  promptId: string
  /** 随机种子。 */
  seed: number
  /** 采样温度。 */
  temperature: number
  /** http(s) 视频地址，由模型网关直接拉取。 */
  video: string
  /** 提示词模板变量（原始结构，函数内按 Python str() 规则序列化为字符串）。 */
  variables: Record<string, unknown>
  /** 取消信号；工具层已把用户取消与超时预算组合为单一信号。 */
  signal: AbortSignal
}

/**
 * 调用标签网关：发送视频地址与服务端模板变量，返回清洗后的 23 维标签。
 * @param request - 端点、凭证、模型与输入参数。
 * @returns 逐字段标准化后的标签对象。
 */
export async function labelVideo(request: LabelVideoRequest): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(request.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: [{
          role: 'user',
          content: [{ type: 'video_url', video_url: { url: request.video } }],
        }],
        prompt_id: request.promptId,
        prompt_variables: promptVariablesOf(request.variables),
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'video_tags', strict: true, schema: videoTagsSchema() },
        },
        seed: request.seed,
        temperature: request.temperature,
        top_p: 1.0,
        stream: false,
      }),
      signal: request.signal,
    })
  } catch (error: unknown) {
    if (request.signal.aborted) throw error
    throw describeFetchFailure(error)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`标签模型调用失败（HTTP ${String(response.status)}）：${detail.slice(0, 500)}`)
  }
  const body: unknown = await response.json()
  return normalizeTags(parseModelJson(readContent(body)))
}
