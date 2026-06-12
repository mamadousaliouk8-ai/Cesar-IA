const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

try {
  // Lire le contenu du presse-papier sur Mac
  const clipboard = execSync('pbpaste').toString().trim();
  
  if (!clipboard) {
    console.error("❌ Le presse-papier est vide. Veuillez d'abord cliquer sur le bouton 'Copier' sur la page HubSpot.");
    process.exit(1);
  }
  
  // Une clé HubSpot complète fait plus de 100 caractères.
  if (clipboard.length < 80) {
    console.error("❌ La clé détectée dans votre presse-papier est incomplète (seulement " + clipboard.length + " caractères).");
    console.error("   Vous avez probablement copié seulement la moitié de la clé.");
    console.error("   Veuillez retourner sur la page HubSpot et cliquer sur le lien bleu 'Copier' (ou double-cliquer pour tout sélectionner).");
    process.exit(1);
  }
  
  const configDir = path.join(process.env.HOME, '.hscli');
  const configPath = path.join(configDir, 'config.yml');
  
  const configContent = `defaultAccount: Cesar-IA
accounts:
  - name: Cesar-IA
    portalId: 148650042
    authType: personalaccesskey
    personalAccessKey: ${clipboard}
`;

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  fs.writeFileSync(configPath, configContent);
  console.log("==================================================");
  console.log("✅ Configuration HubSpot enregistrée avec succès !");
  console.log("==================================================");
  console.log("Fichier configuré : ~/.hscli/config.yml");
  console.log("\nPour valider la connexion, exécutez la commande suivante :");
  console.log("npx -p @hubspot/cli hs accounts");
} catch (error) {
  console.error("❌ Une erreur est survenue :", error.message);
}
