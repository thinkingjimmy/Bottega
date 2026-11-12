/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherZhCN Weather copy for city selection, previews and forecasts.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherZhCNDefinition} from '../definitions/zh-cn';
export const weatherZhCN={
  ...weatherZhCNDefinition,
  "city": "城市",
  "search": "搜索城市",
  "searching": "正在搜索…",
  "addWithoutCity": "稍后选城市",
  "changeCity": "更换城市",
  "cancelCityChange": "取消更换",
  "noCities": "未找到城市。",
  "today": "今天",
  "dailyRange": "最高 {{high}}°C，最低 {{low}}°C",
  "forecastUnavailable": "暂无预报",
  "sizeCurrent": "当前天气",
  "sizeToday": "当前天气和今日最高、最低温",
  "sizeForecast": "当前天气和未来三天预报",
  "failed": "无法获取天气，请重试。",
  "rateLimited": "天气服务繁忙，请稍后重试。",
  "invalid": "无法读取天气数据。",
  "searchFailed": "无法搜索城市。",
  "temperature": "温度",
  "feelsLike": "体感温度",
  "humidity": "湿度",
  "condition": "天气状况",
  "observedAt": "观测时间",
  "attribution": "天气数据来自 Open-Meteo",
  "clear": "晴",
  "partlyCloudy": "局部多云",
  "cloudy": "多云",
  "fog": "雾",
  "drizzle": "毛毛雨",
  "rain": "雨",
  "snow": "雪",
  "showers": "阵雨",
  "thunderstorm": "雷暴",
  "unknown": "未知",
  "usage": "使用 Open-Meteo，仅供个人及非商业使用。",
  "refresh": "刷新"
};
