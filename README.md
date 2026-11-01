<p align="center"><img src="assets/icon.png" width="112" alt=""></p>

<h1 align="center">Tokenmètre</h1>

<p align="center">
  Le compteur de ta consommation <b>Claude Code</b>, dans la zone de notification de Windows.<br>
  Combien de ta limite hebdomadaire tu as déjà brûlé, et si tu vas tenir jusqu'à la réinitialisation.
</p>

<p align="center">
  <a href="https://github.com/ADRENCH/tokenmetre/releases/latest/download/Tokenmetre-Setup.exe"><b>⬇ Télécharger pour Windows</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ADRENCH/tokenmetre/releases/latest">Notes de version</a>
</p>

## Installation

1. Télécharge **[Tokenmetre-Setup.exe](https://github.com/ADRENCH/tokenmetre/releases/latest/download/Tokenmetre-Setup.exe)**.
2. Double-clique dessus. L'installation se fait pour ton compte seulement, sans droits administrateur,
   et crée un raccourci sur le bureau et dans le menu Démarrer.
3. Au premier lancement, Windows peut afficher « Windows a protégé votre ordinateur » : l'app n'est pas
   signée par un éditeur payant. Clique sur **Informations complémentaires**, puis **Exécuter quand même**.

L'app se lance ensuite toute seule à chaque démarrage de Windows, discrètement, dans la zone de
notification. Si l'icône n'apparaît pas, elle est peut-être rangée derrière la flèche **^** : épingle-la
via clic droit sur la barre des tâches › Paramètres de la barre des tâches › Autres icônes.

**Désinstaller** : Paramètres Windows › Applications › Tokenmètre › Désinstaller.

## Ce que ça fait

- **Icône flamme** qui se remplit au fil de la semaine : orange tant que tout va bien, rouge si tu
  risques d'être à court avant la réinitialisation.
- **Aperçu au clic** : % de la semaine, date de réinitialisation, projection, consommation du jour et
  rythme moyen.
- **Tableau de bord** (double-clic) : la consommation de la semaine au fil du temps et son prolongement
  au rythme moyen, l'historique par modèle, projet et session, le coût équivalent API, les réglages.

### Premier réglage

L'app estime ta limite à partir du % affiché par Claude. Ouvre Claude › Réglages › Utilisation, et
recopie dans l'aperçu le % de la limite hebdomadaire « tous modèles ». Si Claude Code a déjà enregistré
ce % sur ton PC, l'app le retrouve toute seule. Refais un relevé de temps en temps, surtout quand le %
a bien monté : plus il est élevé, plus l'estimation est précise.

## Confidentialité

Tout reste sur ton ordinateur.

- L'app ne fait **aucune requête réseau** : ses fenêtres ne chargent que des fichiers locaux, et toute
  autre requête est annulée dans le code (`lockDownNetwork` dans `main.js`).
- Elle **lit** les journaux de Claude Code et n'y écrit jamais. Elle ne touche ni aux identifiants ni au
  jeton de connexion.
- Ses propres fichiers (réglages, cache, archive) sont dans `%APPDATA%\Tokenmètre`.

## D'où viennent les chiffres

- **Journaux** : `~/.claude/projects/**/*.jsonl` (ou `$CLAUDE_CONFIG_DIR/projects`, ou
  `~/.config/claude/projects`), sous-agents compris. Les conversations sur claude.ai ou dans
  l'application de bureau hors Claude Code n'y figurent pas.
- **Archive** : Claude Code efface ses journaux au bout de 30 jours par défaut ; l'app garde ce qu'elle
  en avait lu, pour que l'historique ne fonde pas.
- **Coût équivalent API** : ce que les réponses auraient coûté au tarif public d'Anthropic (tarifs dans
  `scanner.js`), cache 5 min / 1 h et mode rapide compris.
- **Crédit d'abonnement** : le même coût **sans la lecture du cache**, la mesure qui suit le mieux la
  limite hebdomadaire.
- **% de la semaine** : une estimation, arrondie à l'unité comme dans Claude. Claude arrondit aussi
  ses % : un relevé de p % pour un crédit c place la limite entre c / (p + 0,5) et c / (p − 0,5).
  L'app retient la plage compatible avec le plus de relevés, en ne gardant que ceux de la semaine en
  cours quand il y en a ; un relevé incohérent (affichage pas encore actualisé, faute de frappe) est
  écarté et signalé dans les réglages.
- **Projection** : le rythme moyen depuis la dernière réinitialisation (crédit consommé / temps
  écoulé), prolongé jusqu'à la suivante.

## Développement

Il faut [Node.js](https://nodejs.org) 20 ou plus récent.

```bash
npm install
npm start
```

| Commande | Effet |
| --- | --- |
| `npm start` | lance l'app depuis les sources |
| `npm run dist` | construit l'installateur `dist/Tokenmetre-Setup.exe` |
| `npm run icon` | régénère `assets/icon.ico` et `icon.png` depuis `assets/logo.svg` |

| Fichier | Rôle |
| --- | --- |
| `main.js` | icône, fenêtres, démarrage avec Windows, blocage réseau |
| `scanner.js` | lecture des journaux dans un fil séparé (relecture incrémentale, cache, archive) |
| `ui/week.js` | semaine d'abonnement : limite estimée, rythme moyen, projection |
| `ui/common.js` | formats, anneau et graphique de la semaine |
| `ui/popup.*`, `ui/dashboard.*` | aperçu et tableau de bord |

`SUIVI_SNAPSHOT=<dossier> npm start` lance l'app avec une configuration temporaire, enregistre des
captures de l'aperçu, du tableau de bord et de l'icône dans ce dossier, puis quitte.

## Licence

[MIT](LICENSE)
