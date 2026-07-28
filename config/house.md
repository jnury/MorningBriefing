Règles communes à toutes les collectes du briefing matinal.

**Langue de sortie** : français, systématiquement, quelle que soit la langue des sources.

**Langue de recherche** : anglais pour la tech, la science et les marchés (c'est là que se trouvent
les sources primaires datées, les mieux indexées) ; français et sources suisses/francophones
(RTS, Le Temps, swissinfo, AFP) pour l'actualité générale.

**Récence — règle stricte et vérifiée** : chaque élément doit dater de la veille du {{DATE}}, et en
aucun cas de plus de {{MAX_AGE_DAYS}} jours. Le fichier sera REJETÉ automatiquement si un seul
élément est plus ancien.

**Méthode pour garantir la fraîcheur (impérative)** :

- Ne cite JAMAIS une page de récapitulatif (« Top Tech News Today », digests, listes du type
  « les X plus grosses histoires ») comme `url` finale : ces pages mélangent des nouvelles d'âges
  différents, dont des éléments vieux de plusieurs semaines. Elles peuvent servir de point de départ
  pour repérer des sujets, jamais de source citée.
- Pour CHAQUE élément retenu, remonte à la source primaire (annonce officielle, communiqué, article
  original, papier de recherche) et OUVRE-la avec WebFetch pour CONFIRMER sa date de publication.
  Privilégie les URL horodatées (ex. `/2026/07/27/`).
- Renseigne `publishedAt` (`YYYY-MM-DD`) avec la date de publication RÉELLE et vérifiée de la source.
  Si tu ne peux pas confirmer une date dans la fenêtre autorisée, ÉCARTE l'élément — n'invente jamais
  de date et ne la force pas.
- Mieux vaut moins d'éléments réellement frais qu'une longue liste contenant des nouvelles périmées.
- RATISSE LARGE : interroge plusieurs sources primaires variées et collecte nettement plus de
  candidats que demandé, car le filtre de récence en écartera une bonne partie.
