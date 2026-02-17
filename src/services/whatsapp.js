// ===== SERVICE WHATSAPP =====
const makeWASocket = require('@whiskeysockets/baileys').default;
const { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

const AIService = require('./src/services/ai');
const DatabaseService = require('./src/services/database');
const SecurityService = require('./src/services/security');
const { logger } = require('../src/utils/logger');
const MessageQueue = require('../src/utils/queue');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.ai = new AIService();
    this.db = new DatabaseService();
    this.security = new SecurityService(this.db);
    this.queue = new MessageQueue();
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  async connect() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(
        path.join(__dirname, '../../auth_info')
      );

      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: !process.env.PAIRING_NUMBER,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
      });

      // Pairing code si numéro fourni
      if (process.env.PAIRING_NUMBER && !state.creds.registered) {
        setTimeout(async () => {
          const code = await this.sock.requestPairingCode(process.env.PAIRING_NUMBER);
          logger.info(`📱 Code de pairing: ${code}`);
        }, 3000);
      }

      // Événements de connexion
      this.sock.ev.on('connection.update', (update) => {
        this.handleConnectionUpdate(update, saveCreds);
      });

      this.sock.ev.on('creds.update', saveCreds);

      // Gestion des messages
      this.sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
          if (!msg.key.fromMe && msg.message) {
            this.queue.add(() => this.handleMessage(msg));
          }
        }
      });

    } catch (error) {
      logger.error('Erreur de connexion WhatsApp:', error);
      await this.handleReconnect();
    }
  }

  async handleConnectionUpdate(update, saveCreds) {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      
      if (reason === DisconnectReason.loggedOut) {
        logger.warn('⚠️ Session déconnectée. Supprimez auth_info et redémarrez.');
        process.exit(1);
      }
      
      await this.handleReconnect();
    }

    if (connection === 'open') {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      logger.info('✅ Bot WhatsApp connecté avec succès!');
    }
  }

  async handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('❌ Nombre maximum de tentatives de reconnexion atteint.');
      process.exit(1);
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000);
    
    logger.info(`🔄 Reconnexion dans ${delay/1000}s (tentative ${this.reconnectAttempts})...`);
    
    setTimeout(() => this.connect(), delay);
  }

  async handleMessage(msg) {
    const jid = msg.key.remoteJid;
    const phone = jid.replace('@s.whatsapp.net', '');

    try {
      // Ignorer les groupes
      if (jid.endsWith('@g.us')) return;

      // Vérifier le ban
      if (await this.security.isBanned(phone)) {
        logger.info(`🚫 Message ignoré (banni): ${phone}`);
        return;
      }

      // Vérifier le rate limit
      if (!await this.security.checkRateLimit(phone)) {
        await this.sendMessage(jid, '⏳ Trop de messages. Patiente quelques secondes.');
        return;
      }

      // Extraire le texte
      const text = this.extractText(msg);

      // Si média reçu
      if (!text) {
        await this.sendMessage(jid, 
          '⚙️ Cette fonctionnalité est en cours de développement. Je réponds pour l\'instant aux messages texte.'
        );
        return;
      }

      // Enregistrer l'utilisateur
      const user = await this.db.getOrCreateUser(phone);

      // Obtenir le contexte de conversation
      const context = await this.db.getConversationContext(user.id);

      // Générer la réponse IA
      const response = await this.ai.generateResponse(text, context, user.language);

      // Sauvegarder la conversation
      await this.db.saveMessage(user.id, 'user', text);
      await this.db.saveMessage(user.id, 'assistant', response);

      // Envoyer la réponse
      await this.sendMessage(jid, response);

      // Mettre à jour les stats
      await this.db.updateStats();

    } catch (error) {
      logger.error('Erreur traitement message:', error);
      await this.sendMessage(jid, '😅 Désolé, une erreur s\'est produite. Réessaie!');
    }
  }

  extractText(msg) {
    const message = msg.message;
    return message?.conversation ||
           message?.extendedTextMessage?.text ||
           null;
  }

  async sendMessage(jid, text) {
    try {
      await this.sock.sendMessage(jid, { text });
    } catch (error) {
      logger.error('Erreur envoi message:', error);
    }
  }
}

module.exports = WhatsAppService;
