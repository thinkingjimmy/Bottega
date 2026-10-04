/**
 * [INPUT]: Depends on the English Chat runtime catalog shape
 * [OUTPUT]: Provides the French Chat runtime catalog
 * [POS]: French projection for attachment, queue, submission, settings, and recovery messages
 */

import type { chatRuntimeEn } from "./en";

export const chatRuntimeFr: typeof chatRuntimeEn = {
  prepare: { failed: "Impossible de préparer ce Chat : {{message}}", retry: "Réessayer" },
  attachment: {
    grantUnavailable: "« {{name}} » est introuvable. Retirez-le ou ajoutez-le de nouveau depuis son nouvel emplacement.",
    chatLoadFailed: "**Échec du chargement du chat :** {{message}}",
  },
  queue: {
    notPersisted: "Le message n’a pas été enregistré. Corrigez-le et réessayez.",
    recoverable: "Le message peut être récupéré ; le renvoyer créera une nouvelle identité d’envoi.",
    retryAgentTurn: "Le message utilisateur est enregistré. Utilisez « Réessayer le turn Agent ».",
    reconciling: "L’envoi est toujours en cours de rapprochement. Un nouvel essai ordinaire peut l’exécuter deux fois.",
    failedResourcesReleased: "L’envoi a échoué et main a libéré ses ressources de nouvelle tentative. Modifiez-le et renvoyez-le.",
    failed: "L’envoi a échoué.",
    steerReturned: "Le steering n’a pas abouti ; le message est revenu dans la file.",
    staleResourcesDecision: "Le message contient des ressources antérieures au redémarrage. Choisissez un renvoi exact ou supprimez-le.",
    staleWorkspaceWait: "Le message contient des ressources Workspace antérieures au redémarrage. Attendez un résultat exact ou supprimez-le.",
    steerPrepareFailed: "Impossible de préparer le message à insérer : {{message}}",
    steerVerifyFailed: "Impossible de vérifier si le message a été inséré : {{message}}",
    steerHistoryPending: "Le message a été inséré ; son historique est encore en cours d’enregistrement.",
    steerQueuedNext: "Le turn actuel n’a pas consommé le message ; il a été placé ensuite dans la file.",
    steerDeliveryUnknown: "Impossible de confirmer la livraison. Vérifiez la conversation, puis renvoyez ou supprimez le message.",
    turnEnded: "Le turn actuel est terminé ; ce message sera envoyé par la file normale.",
    viewChangedSteerCancelled: "La vue Chat a changé ; le message Steer de l’ancienne vue n’a pas été envoyé.",
    workspaceChangedNoResend: "Le Workspace a changé. Ce message ne peut pas être renvoyé dans le nouveau Workspace ; supprimez-le et saisissez-le à nouveau.",
    durableOutcomeUnavailable: "Le durable outcome est indisponible ; le rapprochement reste actif.",
    mainCustodyPending: "L’envoi est encore sous la garde de main. Attendez un résultat définitif.",
    noSafeNegativeProof: "main n’a pas fourni de preuve sûre que l’envoi n’est jamais arrivé ; il ne peut pas être renvoyé à l’aveugle.",
    ordinaryResendUnavailable: "Cet envoi ne peut pas être renvoyé normalement. Suivez les indications du durable outcome.",
  },
  submission: {
    notReady: "Ce Chat est encore en cours de chargement. Réessayez dans un instant.",
    agentNotReady: "L’Agent n’est pas encore prêt. Réessayez dans un instant.",
    cannotSendNow: "Impossible d’envoyer pour le moment. Réessayez une fois l’action en cours terminée.",
    workspaceChangedChoose: "Le Workspace a changé. Choisissez de nouveau les fichiers ou les Skills, puis envoyez.",
    requestEnded: "Cette requête est déjà terminée.",
    notSavedCannotSteer: "Ce Chat est encore en cours de création, vous ne pouvez donc pas encore compléter la réponse en cours.",
    planRevisionRequired: "Indiquez d’abord ce qu’il faut changer.",
    notSent: "**Message non envoyé :** {{message}}",
    quitting: "Bottega est en train de quitter, ce message n’a donc pas été envoyé.",
    quittingKept: "Bottega est en train de quitter, ce message n’a donc pas été envoyé. Votre message est toujours là.",
    stateUnknown: "**État du message inconnu :** {{message}}. L’identité d’envoi d’origine est conservée ; choisissez de renvoyer ou de supprimer dans la file.",
    relayPaused: "Message mis en file : la chaîne de relais de cette Section est en pause. Traitez d’abord l’avis Continuer en haut du chat.",
    relayPending: "Message mis en file : cette Section contient un message de relais en attente.",
    acceptedRefreshFailed: "L’Agent a accepté le message, mais l’état local de la session n’a pas pu être actualisé : {{message}}. Ne le renvoyez pas ; la tâche continue.",
    backendSetupRequired: "**Terminez d’abord la configuration de {{backend}}.** Le guide d’installation et de connexion est ouvert.",
    localPreparationFailed: "Échec de la préparation de la session locale : {{message}}",
  },
  settings: {
    readFailed: "Échec du chargement des réglages Agent : {{message}}",
    saveFailed: "Échec de l’enregistrement des réglages Agent : {{message}}",
    transcriptReadFailed: "**Échec du chargement des réglages Agent :** {{message}}",
  },
  relayStopFailed: "Impossible d’arrêter toute la chaîne de relais Section ; la requête actuelle a été arrêtée à la place : {{message}}. Vous pouvez réessayer.",
  actionFailed: "**Échec de {{action}} :** {{message}}",
  abandonTurn: "Abandonner le turn",
  acknowledgeCleanup: "Confirmer le nettoyage",
  unnamed: "Sans titre",
};
