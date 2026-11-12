/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherJa Weather copy for city selection, previews and forecasts.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherJaDefinition} from '../definitions/ja';
export const weatherJa={
  ...weatherJaDefinition,
  "city": "都市",
  "search": "都市を検索",
  "searching": "検索中…",
  "addWithoutCity": "都市を選ばずに追加",
  "changeCity": "都市を変更",
  "cancelCityChange": "変更をキャンセル",
  "noCities": "都市が見つかりません。",
  "today": "今日",
  "dailyRange": "最高 {{high}}°C、最低 {{low}}°C",
  "forecastUnavailable": "予報なし",
  "sizeCurrent": "現在の天気",
  "sizeToday": "現在の天気と今日の最高・最低気温",
  "sizeForecast": "現在の天気と今後3日間の予報",
  "failed": "天気を取得できません。再試行してください。",
  "rateLimited": "天気サービスが混雑しています。後で再試行してください。",
  "invalid": "天気データを読み取れません。",
  "searchFailed": "都市を検索できませんでした。",
  "temperature": "気温",
  "feelsLike": "体感温度",
  "humidity": "湿度",
  "condition": "天気",
  "observedAt": "観測時刻",
  "attribution": "天気データ: Open-Meteo",
  "clear": "晴れ",
  "partlyCloudy": "晴れ時々曇り",
  "cloudy": "曇り",
  "fog": "霧",
  "drizzle": "霧雨",
  "rain": "雨",
  "snow": "雪",
  "showers": "にわか雨",
  "thunderstorm": "雷雨",
  "unknown": "不明",
  "usage": "Open-Meteo を個人・非商用で使用します。",
  "refresh": "更新"
};
