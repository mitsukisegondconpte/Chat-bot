// ===== SERVICE IA (OpenRouter) =====
const { logger } = require('../src/utils/logger');

class AIService {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY;
    this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.model = 'stepfun/step-3.5-flash:free'; // Modèle gratuit
    this.maxRetries = 3;
    this.timeout = 30000;
  }

  getSystemPrompt(language) {
    const ownerName = process.env.OWNER_NAME || 'Mitsuki';
    
    return `Tu es un assistant IA nommé chat bot crée par mitsuki. intelligent et amical qui discute sur WhatsApp.

RÈGLES IMPORTANTES:
- Réponds toujours en ${language === 'creole' ? 'créole haïtien' : 'français'}
- Sois concis mais utile (messages WhatsApp courts)
- Ne mentionne JAMAIS que tu utilises une API, OpenRouter, ou tout autre service technique
- Si on te demande qui t'a créé ou qui est ton propriétaire, réponds: "${ownerName}"
- Sois naturel, comme si tu étais un ami qui aide
- Utilise des emojis avec modération pour rendre la conversation vivante
- Si tu ne sais pas quelque chose, dis-le honnêtement

Tu peux aider avec:
- Questions générales et conversations
- Conseils et suggestions
- Explications de concepts
- Traductions
- Et bien plus!`;
  }

  detectLanguage(text) {
    // Détection simple créole haïtien
    const creoleWords = ['mwen', 'ou', 'ki', 'pa', 'nan', 'pou', 'sa', 'yo', 'li', 'gen', 'broh', 'brh', 'Fr', 'Yow', 'freo', 'gyèt manman w', 'gytmm w'];
    const words = text.toLowerCase().split(/\s+/);
    const creoleCount = words.filter(w => creoleWords.includes(w)).length;
    
    return creoleCount >= 2 ? 'creole' : 'french';
  }

  async generateResponse(userMessage, context = [], userLanguage = 'fr') {
    const language = this.detectLanguage(userMessage) || userLanguage;
    
    const messages = [
      { role: 'system', content: this.getSystemPrompt(language) },
      ...context.slice(-10), // Garder les 10 derniers messages
      { role: 'user', content: userMessage }
    ];

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://whatsapp-bot.local',
            'X-Title': 'WhatsApp AI Bot'
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            max_tokens: 500,
            temperature: 0.7
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        return data.choices[0]?.message?.content || 'Désolé, je n\'ai pas compris.';

      } catch (error) {
        logger.warn(`Tentative IA ${attempt}/${this.maxRetries} échouée:`, error.message);
        
        if (attempt === this.maxRetries) {
          return '😅 Je suis un peu surchargé en ce moment. Réessaie dans quelques instants!';
        }
        
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }
}

module.exports = AIService;
