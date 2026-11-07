/**
 * [INPUT]: Only this locale definition labels.
 * [OUTPUT]: The complete weatherJa Weather copy object.
 * [POS]: Deferred locale data; no other locale or aggregate dependency.
 */
import {weatherJaDefinition} from '../definitions/ja';
export const weatherJa={
  ...weatherJaDefinition,
  "current": "現在地",
  "city": "都市を選択",
  "search": "都市を検索",
  "useCurrent": "現在地を使用",
  "locating": "位置を確認中…",
  "located": "位置を確認しました",
  "noCities": "都市が見つかりません。",
  "chooseResult": "検索結果から都市を選択してください。",
  "denied": "位置情報が拒否されました。都市を選ぶか、システム設定で許可してください。",
  "disabled": "位置情報サービスが無効です。都市を選ぶか、システム設定で有効にしてください。",
  "timeout": "位置の確認がタイムアウトしました。再試行するか都市を選択してください。",
  "unavailable": "現在地を取得できません。都市を選択してください。",
  "authorization": "現在地を使用するには位置情報を許可してください。",
  "failed": "天気を取得できません。再試行してください。",
  "rateLimited": "天気サービスが混雑しています。後で再試行してください。",
  "invalid": "天気データを読み取れません。",
  "searchFailed": "都市を検索できません。再試行してください。",
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
