// ===== BOT WHATSAPP IA - POINT D'ENTRÉE =====
require('dotenv').config();

const WhatsAppService = require('./src/services/whatsapp');
const { logger } = require('./src/utils/logger');

// Gestion des erreurs non capturées
process.on('uncaughtException', (err) => {
  logger.error('Erreur non capturée:', err.message);
});

process.on('unhandledRejection', (err) => {
  logger.error('Promise rejetée:', err.message || err);
});

// Gestion de l'arrêt propre
process.on('SIGINT', () => {
  logger.info('🛑 Arrêt du bot (SIGINT)...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('🛑 Arrêt du bot (SIGTERM)...');
  process.exit(0);
});

let whatsappService = null;

async function main() {
  logger.info('🚀 Démarrage du bot WhatsApp IA...');

  // Vérifier les variables d'environnement requises
  const requiredEnv = ['OPENROUTER_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'];
  const missing = requiredEnv.filter(key => !process.env[key]);

  if (missing.length > 0) {
    logger.error(`❌ Variables manquantes: ${missing.join(', ')}`);
    logger.error('Configurez le fichier .env et redémarrez.');
    process.exit(1);
  }

  // Vérifier HuggingFace (optionnel mais recommandé)
  if (!process.env.HUGGINGFACE_API_KEY) {
    logger.warn('⚠️ HUGGINGFACE_API_KEY non définie — fallback IA et multimodal désactivés');
  }

  try {
    whatsappService = new WhatsAppService();
    await whatsappService.connect();
  } catch (error) {
    logger.error('Erreur fatale au démarrage:', error.message);
    logger.info('🔄 Nouvelle tentative dans 10 secondes...');
    setTimeout(main, 10000);
  }
}

main();
