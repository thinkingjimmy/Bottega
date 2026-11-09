/**
 * [INPUT]: Active interface locale and canonical plugin lifecycle and execution states.
 * [OUTPUT]: Localized pluginStatusLabel and executionStateLabel without management UI copy.
 * [POS]: Small status-only boundary shared by execution summaries and lazy plugin details.
 */
const statusKeys=['installed','building','preparing','ready','disabled','failed','draining','cleanup-failed','missing-source','unavailable'];
const statusValues:Record<string,string[]>={
  en:['Installed','Building…','Preparing update…','Ready','Turned off','Update failed','Stopping…','Cleanup failed','Source folder missing','Unavailable'],
  zh:['已安装','正在构建…','正在准备更新…','可用','已停用','更新失败','正在停止…','清理失败','源码文件夹缺失','不可用'],
  ja:['インストール済み','ビルド中…','更新準備中…','利用可能','無効','更新失敗','停止中…','終了処理失敗','ソースフォルダーなし','利用不可'],
  fr:['Installé','Compilation…','Préparation…','Disponible','Désactivé','Échec de mise à jour','Arrêt…','Échec du nettoyage','Dossier source absent','Indisponible'],
  es:['Instalado','Compilando…','Preparando actualización…','Disponible','Desactivado','Error de actualización','Deteniendo…','Error de limpieza','Falta la carpeta de código','No disponible'],
};
const localeKey=(locale:string)=>locale.startsWith('zh')?'zh':locale.split('-')[0]??'en';
export const pluginStatusLabel=(status:string,locale:string)=>(statusValues[localeKey(locale)]??statusValues.en)?.[statusKeys.indexOf(status)]??status;
const executionKeys=['active','idle','running','stopping','stopped','failed','todo','in-progress','blocked','done','cancelled','queued','inserted','delivered','unknown','processed'];
const executionValues:Record<string,string[]>={
  en:['Active','Idle','Running','Stopping','Stopped','Failed','To do','In progress','Blocked','Done','Cancelled','Queued','Inserted into current turn','Delivered','Outcome unknown','Processed'],
  zh:['活跃','空闲','运行中','停止中','已停止','失败','待处理','进行中','受阻','已完成','已取消','已排队','已插入当前回合','已送达','结果未知','已处理'],
  ja:['有効','待機','実行中','停止中','停止済み','失敗','未着手','進行中','ブロック中','完了','キャンセル済み','待機中','現在のターンに挿入済み','配信済み','結果不明','処理済み'],
  fr:['Actif','Inactif','En cours','Arrêt en cours','Arrêté','Échec','À faire','En cours','Bloqué','Terminé','Annulé','En attente','Inséré dans le tour courant','Livré','Résultat inconnu','Traité'],
  es:['Activo','Inactivo','En ejecución','Deteniendo','Detenido','Error','Pendiente','En curso','Bloqueado','Completado','Cancelado','En cola','Insertado en el turno actual','Entregado','Resultado desconocido','Procesado'],
};
export const executionStateLabel=(state:string,locale:string)=>(executionValues[localeKey(locale)]??executionValues.en)?.[executionKeys.indexOf(state)]??state;
