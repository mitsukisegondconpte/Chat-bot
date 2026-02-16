// ===== SERVICE SÉCURITÉ =====
const { logger } = require('../src/utils/logger');

class SecurityService {
  constructor(db) {
    this.db = db;
    this.cooldowns = new Map();
    this.cooldownSeconds = parseInt(process.env.COOLDOWN_SECONDS) || 3;
  }

  async isBanned(phone) {
    return await this.db.isBanned(phone);
  }

  async checkRateLimit(phone) {
    // Vérifier le cooldown local (mémoire)
    const lastMessage = this.cooldowns.get(phone);
    const now = Date.now();
    
    if (lastMessage && (now - lastMessage) < this.cooldownSeconds * 1000) {
      return false;
    }
    
    this.cooldowns.set(phone, now);
    
    // Nettoyage périodique du cache cooldown
    if (this.cooldowns.size > 1000) {
      const cutoff = now - 60000;
      for (const [key, time] of this.cooldowns.entries()) {
        if (time < cutoff) this.cooldowns.delete(key);
      }
    }

    // Vérifier le rate limit DB
    return await this.db.checkRateLimit(phone);
  }

  async banUser(phone, reason, expiresInHours = null) {
    try {
      const expiresAt = expiresInHours 
        ? new Date(Date.now() + expiresInHours * 3600000).toISOString()
        : null;

      await this.db.supabase
        .from('bans')
        .upsert({ 
          phone_number: phone, 
          reason,
          expires_at: expiresAt 
        });

      logger.info(`🚫 Utilisateur banni: ${phone} - ${reason}`);
    } catch (error) {
      logger.error('Erreur ban utilisateur:', error);
    }
  }

  async unbanUser(phone) {
    try {
      await this.db.supabase
        .from('bans')
        .delete()
        .eq('phone_number', phone);
      
      logger.info(`✅ Utilisateur débanni: ${phone}`);
    } catch (error) {
      logger.error('Erreur unban utilisateur:', error);
    }
  }
}

module.exports = SecurityService;
