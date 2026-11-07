/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherZhCN Weather copy object; the unused city-result instruction is excluded.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherZhCNDefinition} from '../definitions/zh-cn';
export const weatherZhCN={
  ...weatherZhCNDefinition,
  "current": "当前位置",
  "city": "选择城市",
  "search": "搜索城市",
  "useCurrent": "使用当前位置",
  "locating": "正在定位…",
  "located": "定位成功",
  "noCities": "未找到城市。",
  "denied": "定位权限被拒绝。请选择城市，或在系统设置中允许定位。",
  "disabled": "系统定位已关闭。请选择城市，或在系统设置中开启。",
  "timeout": "定位超时。请重试或选择城市。",
  "unavailable": "系统定位不可用。请选择城市。",
  "authorization": "请允许定位以使用当前位置。",
  "failed": "无法获取天气，请重试。",
  "rateLimited": "天气服务繁忙，请稍后重试。",
  "invalid": "无法读取天气数据。",
  "searchFailed": "无法搜索城市，请重试。",
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
