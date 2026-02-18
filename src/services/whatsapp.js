// ===== SERVICE WHATSAPP =====
const makeWASocket = require('@whiskeysockets/baileys').default;
const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

const AIService = require('./ai');
const DatabaseService = require('./database');
const SecurityService = require('./security');
const { logger } = require('../utils/logger');
const MessageQueue = require('../utils/queue');

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

      // ===== PAIRING CODE (connexion par numéro de téléphone) =====
      if (process.env.PAIRING_NUMBER && !state.creds.registered) {
        const phoneNumber = process.env.PAIRING_NUMBER.replace(/[^0-9]/g, '');
        logger.info(`📱 Connexion par pairing code pour le numéro: ${phoneNumber}`);

        setTimeout(async () => {
          try {
            const code = await this.sock.requestPairingCode(phoneNumber);
            logger.info(`\n╔══════════════════════════════════╗`);
            logger.info(`║   📱 CODE DE PAIRING: ${code}     ║`);
            logger.info(`╚══════════════════════════════════╝`);
            logger.info(`\nVa dans WhatsApp > Paramètres > Appareils liés > Lier un appareil`);
            logger.info(`Puis choisis "Lier avec un numéro de téléphone" et entre ce code.`);
          } catch (error) {
            logger.error('Erreur pairing code:', error.message);
            logger.info('💡 Astuce: Retire PAIRING_NUMBER du .env pour utiliser le QR code.');
          }
        }, 3000);
      }

      // ===== Événements de connexion =====
      this.sock.ev.on('connection.update', (update) => {
        this.handleConnectionUpdate(update, saveCreds);
      });

      this.sock.ev.on('creds.update', saveCreds);

      // ===== Gestion des messages =====
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
        logger.warn('⚠️ Session déconnectée. Supprimez auth_info/ et redémarrez.');
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

    logger.info(`🔄 Reconnexion dans ${delay / 1000}s (tentative ${this.reconnectAttempts})...`);

    setTimeout(() => this.connect(), delay);
  }

  // ===== Routage principal des messages =====
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

      // Détecter le type de message
      const messageType = this.getMessageType(msg);

      // Indicateur de frappe
      await this.sock.sendPresenceUpdate('composing', jid);

      switch (messageType) {
        case 'image':
          await this.handleImage(msg, jid, phone);
          break;
        case 'audio':
          await this.handleAudio(msg, jid, phone);
          break;
        case 'text':
          await this.handleText(msg, jid, phone);
          break;
        default:
          await this.sendMessage(jid, "Désolée, je ne peux pas traiter ce type de message pour le moment 😕");
      }

      // Fin frappe
      await this.sock.sendPresenceUpdate('available', jid);

    } catch (error) {
      logger.error('Erreur traitement message:', error);
      await this.sendMessage(jid, '😅 Désolé, une erreur s\'est produite. Réessaie!');
    }
  }

  // ===== Détection type de message =====
  getMessageType(msg) {
    const m = msg.message;
    if (!m) return 'unknown';
    if (m.imageMessage) return 'image';
    if (m.audioMessage || m.pttMessage) return 'audio';
    if (m.conversation || m.extendedTextMessage) return 'text';
    return 'unknown';
  }

  // ===== Traitement texte =====
  async handleText(msg, jid, phone) {
    const text = this.extractText(msg);
    if (!text) return;

    // Filtre contenu dangereux
    const filter = this.security.filterContent(text);
    if (filter.blocked) {
      await this.sendMessage(jid, filter.reason);
      return;
    }

    // Routage intelligent : génération d'image ?
    const intent = this.ai.detectIntent(text);

    if (intent === 'generate_image') {
      const prompt = this.ai.extractImagePrompt(text);
      await this.sendMessage(jid, '🎨 Je génère ton image, un instant...');

      const imageBuffer = await this.ai.generateImage(prompt);
      if (imageBuffer) {
        await this.sock.sendMessage(jid, {
          image: imageBuffer,
          caption: `🖼️ Voilà ! Image générée pour : "${prompt}"`
        });
      } else {
        await this.sendMessage(jid, "Désolée, je n'ai pas pu générer l'image 😕 Réessaie avec une autre description !");
      }
      return;
    }

    // Chat normal avec historique
    const user = await this.db.getOrCreateUser(phone);
    const context = await this.db.getConversationContext(user.id);
    const response = await this.ai.generateResponse(text, context, user.language);

    await this.db.saveMessage(user.id, 'user', text);
    await this.db.saveMessage(user.id, 'assistant', response);
    await this.sendMessage(jid, response);
    await this.db.updateStats();
  }

  // ===== Traitement image =====
  async handleImage(msg, jid, phone) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const caption = msg.message.imageMessage?.caption || '';

      await this.sendMessage(jid, '🔍 J\'analyse ton image...');

      const analysis = await this.ai.analyzeImage(buffer);

      const user = await this.db.getOrCreateUser(phone);
      await this.db.saveMessage(user.id, 'user', `[Image envoyée] ${caption}`);
      await this.db.saveMessage(user.id, 'assistant', analysis);

      await this.sendMessage(jid, analysis);
    } catch (error) {
      logger.error('Erreur traitement image:', error.message);
      await this.sendMessage(jid, "Désolée, je n'ai pas pu analyser ton image 😕");
    }
  }

  // ===== Traitement audio =====
  async handleAudio(msg, jid, phone) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});

      await this.sendMessage(jid, '🎤 Je transcris ton audio...');

      const transcription = await this.ai.transcribeAudio(buffer);

      if (!transcription) {
        await this.sendMessage(jid, "Désolée, je n'ai pas pu comprendre ton audio 😕");
        return;
      }

      await this.sendMessage(jid, `📝 J'ai compris : "${transcription}"`);

      // Filtre contenu
      const filter = this.security.filterContent(transcription);
      if (filter.blocked) {
        await this.sendMessage(jid, filter.reason);
        return;
      }

      // Envoyer à l'IA
      const user = await this.db.getOrCreateUser(phone);
      await this.db.saveMessage(user.id, 'user', transcription);
      const context = await this.db.getConversationContext(user.id);
      const response = await this.ai.generateResponse(transcription, context, user.language);
      await this.db.saveMessage(user.id, 'assistant', response);
      await this.sendMessage(jid, response);
    } catch (error) {
      logger.error('Erreur traitement audio:', error.message);
      await this.sendMessage(jid, "Désolée, je n'ai pas pu traiter ton message vocal 😕");
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
