/**
 * [INPUT]: Locale and the shared Plan, thinking and elapsed presentation labels.
 * [OUTPUT]: turnCopy and planTranslation for portable turn adapters.
 * [POS]: Shared turn presentation copy; native hosts may inject their translator.
 */
const labels = {
  "en": {
    "thinking": "Thinking",
    "plan": {
      "editingAria": "Plan is being edited",
      "editing": "Editing",
      "title": "Plan",
      "copy": "Copy Plan",
      "copied": "Copied",
      "collapsePanel": "Collapse the Plan side panel",
      "showPanel": "Show Plan in the side panel",
      "showFullPanel": "Show the full Plan in the side panel"
    },
    "workingFor": "Working for {{duration}}"
  },
  "zh": {
    "thinking": "思考中",
    "plan": {
      "editingAria": "正在编辑 Plan",
      "editing": "编辑中",
      "title": "Plan",
      "copy": "复制 Plan",
      "copied": "已复制",
      "collapsePanel": "收起 Plan 第三栏",
      "showPanel": "在第三栏显示 Plan",
      "showFullPanel": "在第三栏显示完整 Plan"
    },
    "workingFor": "已处理 {{duration}}"
  },
  "ja": {
    "thinking": "考え中",
    "plan": {
      "editingAria": "Plan を編集中",
      "editing": "編集中",
      "title": "Plan",
      "copy": "Plan をコピー",
      "copied": "コピーしました",
      "collapsePanel": "Plan のサイドパネルを閉じる",
      "showPanel": "サイドパネルに Plan を表示",
      "showFullPanel": "サイドパネルに Plan 全体を表示"
    },
    "workingFor": "{{duration}} 処理中"
  },
  "fr": {
    "thinking": "Réflexion en cours",
    "plan": {
      "editingAria": "Modification du Plan en cours",
      "editing": "Modification",
      "title": "Plan",
      "copy": "Copier le Plan",
      "copied": "Copié",
      "collapsePanel": "Fermer le panneau latéral du Plan",
      "showPanel": "Afficher le Plan dans le panneau latéral",
      "showFullPanel": "Afficher le Plan complet dans le panneau latéral"
    },
    "workingFor": "Traitement depuis {{duration}}"
  },
  "es": {
    "thinking": "Pensando",
    "plan": {
      "editingAria": "Editando el Plan",
      "editing": "Editando",
      "title": "Plan",
      "copy": "Copiar Plan",
      "copied": "Copiado",
      "collapsePanel": "Cerrar el panel lateral del Plan",
      "showPanel": "Mostrar el Plan en el panel lateral",
      "showFullPanel": "Mostrar el Plan completo en el panel lateral"
    },
    "workingFor": "Trabajando durante {{duration}}"
  }
};
export function turnCopy(locale: string) { return labels[locale.toLowerCase().split("-")[0] as keyof typeof labels] ?? labels.en; }
export function planTranslation(locale: string) { const copy = turnCopy(locale).plan; return (key: string) => copy[key.replace("chat.transcript.plan.", "") as keyof typeof copy] ?? key; }
