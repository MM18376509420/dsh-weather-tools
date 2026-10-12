// src/get_weather.ts
const WEATHER: Record<string, string> = {
  '深圳': '晴朗，28°C，湿度65%',
  '北京': '多云，22°C，湿度45%',
  '上海': '小雨，25°C，湿度80%',
}

export function getWeather(city: string): string {
  return WEATHER[city] ?? `未找到${city}的天气数据`
}
