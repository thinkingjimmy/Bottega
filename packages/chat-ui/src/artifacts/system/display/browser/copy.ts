/**
 * [INPUT]: Current application locale.
 * [OUTPUT]: Five-language fixed System browser labels.
 * [POS]: Read-only Theme browser copy shared by desktop and encrypted Web.
 */
const en={theme:"Theme",chooseVersion:"Choose version",browse:"Browse system",empty:"Choose a saved System version to use in this work.",title:"Design system",readonly:"Read only · fixed version",choose:"System",failed:"This fixed system cannot be opened. Bind its saved version again to include the complete copy.",close:"Close"};
export function systemBrowserCopy(locale="en"){
  if(locale.startsWith("zh"))return{theme:"主题",chooseVersion:"选择版本",browse:"浏览系统",empty:"选择此作品使用的已保存系统版本。",title:"设计系统",readonly:"只读 · 固定版本",choose:"设计系统",failed:"无法打开此固定系统。请重新绑定已保存版本，以包含完整副本。",close:"关闭"};
  if(locale.startsWith("ja"))return{theme:"テーマ",chooseVersion:"バージョンを選択",browse:"システムを表示",empty:"この作品で使う保存済みシステムを選んでください。",title:"デザインシステム",readonly:"読み取り専用 · 固定バージョン",choose:"システム",failed:"この固定システムを開けません。保存したバージョンを再度関連付けて、完全なコピーを含めてください。",close:"閉じる"};
  if(locale.startsWith("es"))return{theme:"Tema",chooseVersion:"Elegir versión",browse:"Ver sistema",empty:"Elige una versión guardada para este trabajo.",title:"Sistema de diseño",readonly:"Solo lectura · versión fija",choose:"Sistema",failed:"No se puede abrir este sistema fijo. Vuelve a vincular la versión guardada para incluir su copia completa.",close:"Cerrar"};
  if(locale.startsWith("fr"))return{theme:"Thème",chooseVersion:"Choisir la version",browse:"Voir le système",empty:"Choisissez une version enregistrée pour ce travail.",title:"Système de design",readonly:"Lecture seule · version fixe",choose:"Système",failed:"Impossible d’ouvrir ce système fixe. Associez de nouveau sa version enregistrée pour inclure une copie complète.",close:"Fermer"};
  return en;
}
