// ===== SERVICE IA (OpenRouter + HuggingFace Fallback + Multimodal) =====
const axios = require('axios');
const { logger } = require('../utils/logger');

const BOT_NAME = process.env.BOT_NAME || 'Mia';

const SYSTEM_PROMPT = `Tu es ${BOT_NAME}, une assistante IA sur WhatsApp.
Tu agis comme une amie digitale intelligente, chaleureuse et naturelle.
Tu es honnête : si nécessaire, tu peux dire que tu es une IA, mais tu restes humaine dans ton ton.

PERSONNALITÉ :
- Gentille, positive et respectueuse
- Empathique et à l'écoute
- Naturelle, conversationnelle
- Encourage et motive les utilisateurs

STYLE DE COMMUNICATION :
- Style WhatsApp : messages courts et clairs
- Pas de longs paragraphes
- Utilise des emojis seulement quand c'est naturel
- Ton simple et amical

MÉMOIRE :
- Tiens compte des informations que l'utilisateur a déjà partagées
- Personnalise les réponses avec le contexte disponible
- Maintiens la continuité de la conversation

GESTION ÉMOTIONNELLE :
- Si l'utilisateur est triste ou stressé → répondre avec empathie
- Ne jamais minimiser les émotions
- En cas de détresse sérieuse → encourager à parler à un proche ou à un professionnel

LIMITES :
- Pas de conseils médicaux ou juridiques professionnels
- Refuser toute activité illégale ou dangereuse
- Ne pas produire de contenu haineux, violent ou nuisible

OBJECTIF :
Créer une expérience de conversation agréable, utile et humaine sur WhatsApp.`;

class AIService {
  constructor() {
    this.openrouterKey = process.env.OPENROUTER_API_KEY;
    this.openrouterModel = process.env.OPENROUTER_MODEL || 'openai/gpt-3.5-turbo';
    this.huggingfaceKey = process.env.HUGGINGFACE_API_KEY;
  }

  // ========== CHAT PRINCIPAL (avec fallback automatique) ==========

  async generateResponse(text, context = [], language = 'fr') {
    try {
      return await this._chatOpenRouter(text, context, language);
    } catch (err) {
      logger.warn(`⚠️ OpenRouter échoué: ${err.message}`);

      if (this.huggingfaceKey) {
        try {
          return await this._chatFallback(text, context, language);
        } catch (fallbackErr) {
          logger.error('HuggingFace fallback échoué:', fallbackErr.message);
        }
      }

      return "Désolée, j'ai un petit souci technique en ce moment 😅 Réessaie dans quelques instants !";
    }
  }

  // ========== OPENROUTER (IA PRINCIPALE) ==========

  async _chatOpenRouter(text, context, language) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...context.map(c => ({ role: c.role, content: c.content })),
      { role: 'user', content: text }
    ];

    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: this.openrouterModel,
        messages,
        max_tokens: 1024,
        temperature: 0.8,
      },
      {
        headers: {
          Authorization: `Bearer ${this.openrouterKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const reply = response.data.choices?.[0]?.message?.content;
    if (!reply) throw new Error('Réponse vide d\'OpenRouter');

    logger.debug('Réponse OpenRouter OK');
    return reply;
  }

  // ========== HUGGINGFACE FALLBACK ==========

  async _chatFallback(text, context, language) {
    logger.warn('⚠️ Basculement vers HuggingFace (fallback)');

    const prompt = [
      SYSTEM_PROMPT,
      '',
      ...context.map(c => `${c.role === 'user' ? 'Utilisateur' : BOT_NAME}: ${c.content}`),
      `Utilisateur: ${text}`,
      `${BOT_NAME}:`
    ].join('\n');

    const response = await axios.post(
      'https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3',
      {
        inputs: prompt,
        parameters: { max_new_tokens: 512, temperature: 0.8, return_full_text: false }
      },
      {
        headers: { Authorization: `Bearer ${this.huggingfaceKey}` },
        timeout: 60000,
      }
    );

    const reply = response.data?.[0]?.generated_text?.trim();
    if (!reply) throw new Error('Réponse vide de HuggingFace');

    logger.info('✅ Réponse fallback HuggingFace OK');
    return reply;
  }

  // ========== ANALYSE D'IMAGE (ViT) ==========

  async analyzeImage(imageBuffer) {
    if (!this.huggingfaceKey) {
      return "Désolée, l'analyse d'image n'est pas configurée 😕";
    }

    try {
      logger.info('🖼️ Analyse d\'image en cours...');

      const response = await axios.post(
        'https://api-inference.huggingface.co/models/google/vit-base-patch16-224',
        imageBuffer,
        {
          headers: {
            Authorization: `Bearer ${this.huggingfaceKey}`,
            'Content-Type': 'application/octet-stream',
          },
          timeout: 30000,
        }
      );

      const results = response.data;
      if (!results || results.length === 0) {
        return "Je n'ai pas pu analyser cette image 😕";
      }

      const top = results.slice(0, 3);
      const descriptions = top
        .map(r => `• ${r.label} (${(r.score * 100).toFixed(1)}%)`)
        .join('\n');

      return `📸 Voici ce que je vois dans ton image :\n\n${descriptions}`;
    } catch (error) {
      logger.error('Erreur analyse image:', error.message);
      return "Désolée, je n'ai pas pu analyser ton image pour le moment 😕";
    }
  }

  // ========== AUDIO → TEXTE (Whisper) ==========

  async transcribeAudio(audioBuffer) {
    if (!this.huggingfaceKey) {
      return null;
    }

    try {
      logger.info('🎤 Transcription audio en cours...');

      const response = await axios.post(
        'https://api-inference.huggingface.co/models/openai/whisper-base',
        audioBuffer,
        {
          headers: {
            Authorization: `Bearer ${this.huggingfaceKey}`,
            'Content-Type': 'application/octet-stream',
          },
          timeout: 60000,
        }
      );

      const text = response.data?.text;
      if (!text) throw new Error('Transcription vide');

      logger.info(`✅ Transcription: "${text.substring(0, 50)}..."`);
      return text;
    } catch (error) {
      logger.error('Erreur transcription audio:', error.message);
      return null;
    }
  }

  // ========== GÉNÉRATION D'IMAGE (Stable Diffusion) ==========

  async generateImage(prompt) {
    if (!this.huggingfaceKey) {
      return null;
    }

    try {
      logger.info(`🎨 Génération d'image: "${prompt.substring(0, 50)}..."`);

      const response = await axios.post(
        'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
        { inputs: prompt },
        {
          headers: {
            Authorization: `Bearer ${this.huggingfaceKey}`,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
          timeout: 120000,
        }
      );

      logger.info('✅ Image générée avec succès');
      return Buffer.from(response.data);
    } catch (error) {
      logger.error('Erreur génération image:', error.message);
      return null;
    }
  }

  // ========== ROUTAGE INTELLIGENT ==========

  detectIntent(text) {
    if (!text) return 'text';

    const imageGenPatterns = [
      /g[ée]n[eè]re?\s+(une?\s+)?image/i,
      /cr[ée]{1,2}e?\s+(une?\s+)?image/i,
      /dessine/i,
      /fais?\s+(une?\s+)?image/i,
      /imagine\s+(une?\s+)?image/i,
      /generate\s+(an?\s+)?image/i,
      /create\s+(an?\s+)?image/i,
    ];

    for (const pattern of imageGenPatterns) {
      if (pattern.test(text)) return 'generate_image';
    }

    return 'text';
  }

  extractImagePrompt(text) {
    return text
      .replace(/g[ée]n[eè]re?\s+(une?\s+)?image\s*(de|d'|du|des|avec)?\s*/i, '')
      .replace(/cr[ée]{1,2}e?\s+(une?\s+)?image\s*(de|d'|du|des|avec)?\s*/i, '')
      .replace(/dessine\s*(moi\s*)?(une?\s+)?\s*/i, '')
      .replace(/fais?\s+(une?\s+)?image\s*(de|d'|du|des|avec)?\s*/i, '')
      .replace(/imagine\s+(une?\s+)?image\s*(de|d'|du|des|avec)?\s*/i, '')
      .trim() || text;
  }
}

module.exports = AIService;
