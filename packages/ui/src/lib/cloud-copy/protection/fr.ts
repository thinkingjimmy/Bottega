/**
 * [INPUT]: The shared protection copy contract.
 * [OUTPUT]: French offline reading, the per-device offline switch and phone offer, background mask, secure-storage recovery and biometric setting messages.
 * [POS]: Shared Cloud Web / mobile shell presentation.
 */
import type { CloudProtectionCopy } from "./en";
export const fr: CloudProtectionCopy = {
  offlineBanner: "Hors ligne · Dernière synchronisation {{time}}", offlineBannerUnknown: "Hors ligne · Contenu enregistré affiché",
  offlineReadOnly: "Lecture seule. L’envoi, la modification et les téléchargements reviennent une fois reconnecté.", reconnecting: "Reconnexion…",
  savedChats: "Conversations enregistrées", allChats: "Toutes les conversations",
  offlineEmpty: "Aucune conversation n’est encore enregistrée sur cet appareil. Connectez-vous pour charger votre espace de travail.",
  offlineChatMissing: "Cette conversation n’est pas enregistrée pour la lecture hors ligne.",
  offlineEarlier: "Les messages plus anciens sont disponibles une fois de retour en ligne.",
  offlineDecryptFailed: "Le contenu enregistré n’a pas pu être déchiffré. Connectez-vous pour le recharger.",
  offlineUnavailableTitle: "Connectez-vous pour ouvrir votre espace de travail",
  offlineExpired: "Cet appareil ne s’est pas connecté depuis trop longtemps. Connectez-vous à Internet pour continuer à lire.",
  offlineNoSnapshot: "La lecture hors ligne n’est pas activée sur cet appareil. Activez-la dans les Réglages lorsque vous êtes en ligne.",
  offlineClock: "L’horloge de cet appareil a reculé. Connectez-vous à Internet pour vérifier l’accès.",
  offlineOpening: "Ouverture du contenu enregistré…", retry: "Réessayer",
  maskTitle: "Bottega est verrouillé", maskDescription: "Confirmez votre identité pour afficher votre espace de travail.", maskResume: "Déverrouiller", maskVerifying: "Vérification…",
  maskCancelled: "La vérification a été annulée. Réessayez ou utilisez votre mot de passe de synchronisation.", usePassword: "Utiliser le mot de passe de synchronisation",
  capabilityMissing: "Le stockage sécurisé de cet appareil est indisponible pour le moment : la clé de déverrouillage enregistrée ne peut pas être ouverte. Redémarrez ou mettez à jour l’app, ou saisissez votre mot de passe de synchronisation.",
  biometricChanged: "Vos empreintes ou votre visage enregistrés ont changé : la clé de déverrouillage enregistrée ne peut plus être ouverte. Saisissez une fois votre mot de passe de synchronisation.",
  biometricLabel: "Exiger l’empreinte ou le visage",
  biometricDescription: "Vérifiez avec votre empreinte ou votre visage chaque fois que vous revenez dans Bottega. Si vos empreintes ou votre visage enregistrés changent, votre mot de passe de synchronisation sera demandé une fois.",
  biometricNotEnrolled: "Configurez le déverrouillage par empreinte ou visage dans les réglages du téléphone pour utiliser cette option.",
  biometricNeedsKeepUnlocked: "Déverrouillez d’abord avec votre mot de passe de synchronisation en activant « Rester déverrouillé ».",
  biometricFailed: "Le réglage n’a pas pu être enregistré. Réessayez.",
  offlinePhoneLabel: "Garder les conversations disponibles hors ligne sur ce téléphone",
  offlineBrowserLabel: "Faire confiance à ce navigateur pour la lecture hors ligne",
  offlineDescription: "Enregistre ce dont cet appareil a besoin pour ouvrir vos conversations enregistrées sans connexion. Il peut les ouvrir hors ligne jusqu’à 30 jours après sa dernière connexion, puis doit se reconnecter. Les conversations déjà enregistrées sur cet appareil y restent jusqu’à ce que vous désactiviez cette option, verrouilliez cet appareil ou vous déconnectiez.",
  offlineBrowserWarning: "N’activez cette option que dans un navigateur de confiance : toute personne pouvant utiliser ce profil de navigateur peut ouvrir les conversations enregistrées hors ligne.",
  offlineChangeFailed: "La lecture hors ligne n’a pas pu être modifiée. Réessayez.",
  offlineOfferTitle: "Garder les conversations disponibles hors ligne sur ce téléphone ?",
  offlineOfferBody: "Vos conversations enregistrées s’ouvriront sans connexion jusqu’à 30 jours après la dernière connexion de ce téléphone. Vous pouvez désactiver cette option à tout moment dans les Réglages, ce qui supprime la copie hors ligne.",
  offlineOfferAccept: "Garder hors ligne",
  offlineOfferDecline: "Plus tard",
};
