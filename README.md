<p align="center"><img src="assets/icon.png" width="96" alt=""></p>

# Suivi tokens

Une petite app de bureau pour suivre sa consommation de **Claude Code** : tokens, modèles,
coût équivalent API et, surtout, la part de sa **limite hebdomadaire d'abonnement** déjà utilisée,
avec une projection de la fin de semaine selon sa façon de travailler.

- **Icône dans la zone de notification** : une flamme qui se remplit au fil de la semaine
  (orange : dans les clous, rouge : à court avant la réinitialisation).
- **Aperçu au clic** : % de la semaine, date de réinitialisation, projection, consommation du
  jour et rythme moyen.
- **Tableau de bord** : la consommation de la semaine au fil du temps et son prolongement au
  rythme moyen, l'historique par modèle, projet et session, les réglages.
- **Démarrage avec Windows**, discret, directement dans la zone de notification.

## Confidentialité

Tout reste sur l'ordinateur.

- L'app ne fait **aucune requête réseau** : les fenêtres ne chargent que des fichiers locaux, et
  toute autre requête est annulée dans le code (`lockDownNetwork` dans `main.js`).
- Elle **lit** les journaux de Claude Code et n'y écrit jamais. Elle ne touche ni aux identifiants
  ni au jeton de connexion.
- Ses propres fichiers (réglages, cache) sont dans le dossier de données de l'app :
  `%APPDATA%\Suivi tokens` sous Windows.

## Installation

Il faut [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install
npm start
```

Au premier lancement, l'app s'inscrit au démarrage de Windows (désactivable dans le menu de
l'icône ou dans les réglages). Pour l'arrêter : clic droit sur l'icône › Quitter.

## D'où viennent les chiffres

- **Journaux** : `~/.claude/projects/**/*.jsonl` (ou `$CLAUDE_CONFIG_DIR/projects`,
  ou `~/.config/claude/projects`), sous-agents compris. Les conversations sur claude.ai ou dans
  l'application de bureau hors Claude Code n'y figurent pas.
- **Coût équivalent API** : ce que les réponses auraient coûté au tarif public d'Anthropic
  (tarifs dans `scanner.js`), cache 5 min / 1 h et mode rapide compris.
- **Crédit d'abonnement** : le même coût **sans la lecture du cache**. C'est la mesure qui suit le
  mieux la limite hebdomadaire.
- **% de la semaine** : une estimation. La limite est déduite des relevés, c'est-à-dire du %
  affiché par Claude (Réglages › Utilisation) à un instant donné :
  `limite ≈ somme des crédits consommés / somme des % relevés`. Le dernier relevé que Claude Code
  garde dans `~/.claude.json` est importé automatiquement ; on en ajoute à la main depuis l'aperçu.
  Plus le % relevé est élevé, plus l'estimation est précise.
- **Projection** : le rythme moyen depuis la dernière réinitialisation (crédit consommé / temps
  écoulé), prolongé jusqu'à la suivante. La consommation varie trop d'une semaine à l'autre pour
  s'appuyer sur les semaines passées.

## Développement

| Fichier | Rôle |
| --- | --- |
| `main.js` | icône, fenêtres, démarrage avec Windows, blocage réseau |
| `scanner.js` | lecture des journaux dans un fil séparé (relecture incrémentale, cache) |
| `ui/week.js` | semaine d'abonnement : limite estimée, rythme moyen, projection |
| `ui/common.js` | formats, anneau et graphique de la semaine |
| `ui/popup.*`, `ui/dashboard.*` | aperçu et tableau de bord |
| `assets/logo.svg` | logo ; `npm run icon` régénère `icon.ico` et `icon.png` |

`SUIVI_SNAPSHOT=<dossier> npm start` lance l'app avec une configuration temporaire, enregistre des
captures de l'aperçu, du tableau de bord et de l'icône dans ce dossier, puis quitte.
