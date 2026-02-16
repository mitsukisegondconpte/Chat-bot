// ===== SERVICE BASE DE DONNÉES (Supabase) =====
const { createClient } = require('@supabase/supabase-js');
const { logger } = require('../src/utils/logger');

class DatabaseService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }

  async getOrCreateUser(phone) {
    try {
      // Chercher l'utilisateur existant
      let { data: user } = await this.supabase
        .from('whatsapp_users')
        .select('*')
        .eq('phone_number', phone)
        .single();

      if (!user) {
        // Créer un nouvel utilisateur
        const { data: newUser, error } = await this.supabase
          .from('whatsapp_users')
          .insert({ phone_number: phone })
          .select()
          .single();

        if (error) throw error;
        user = newUser;
        logger.info(`👤 Nouvel utilisateur créé: ${phone}`);
      }

      // Mettre à jour last_message_at
      await this.supabase
        .from('whatsapp_users')
        .update({ 
          last_message_at: new Date().toISOString(),
          message_count: (user.message_count || 0) + 1
        })
        .eq('id', user.id);

      return user;
    } catch (error) {
      logger.error('Erreur DB getOrCreateUser:', error);
      return { id: phone, language: 'fr' };
    }
  }

  async getConversationContext(userId, limit = 20) {
    try {
      const { data } = await this.supabase
        .from('conversations')
        .select('role, content')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      return (data || []).reverse();
    } catch (error) {
      logger.error('Erreur DB getConversationContext:', error);
      return [];
    }
  }

  async saveMessage(userId, role, content) {
    try {
      await this.supabase
        .from('conversations')
        .insert({ user_id: userId, role, content });

      // Nettoyage automatique des vieilles conversations (garder 50 max)
      await this.cleanupOldConversations(userId);
    } catch (error) {
      logger.error('Erreur DB saveMessage:', error);
    }
  }

  async cleanupOldConversations(userId) {
    try {
      const { data: messages } = await this.supabase
        .from('conversations')
        .select('id')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (messages && messages.length > 50) {
        const idsToDelete = messages.slice(50).map(m => m.id);
        await this.supabase
          .from('conversations')
          .delete()
          .in('id', idsToDelete);
      }
    } catch (error) {
      logger.error('Erreur cleanup conversations:', error);
    }
  }

  async updateStats() {
    try {
      const today = new Date().toISOString().split('T')[0];
      
      await this.supabase.rpc('increment_stat', { 
        stat_date: today,
        stat_field: 'messages_received'
      });
    } catch (error) {
      // Ignorer les erreurs de stats
    }
  }

  async isBanned(phone) {
    try {
      const { data } = await this.supabase
        .from('bans')
        .select('id, expires_at')
        .eq('phone_number', phone)
        .single();

      if (!data) return false;
      
      // Vérifier si le ban a expiré
      if (data.expires_at && new Date(data.expires_at) < new Date()) {
        await this.supabase.from('bans').delete().eq('id', data.id);
        return false;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkRateLimit(phone) {
    try {
      const minuteKey = new Date().toISOString().slice(0, 16);
      const maxPerMinute = parseInt(process.env.MAX_MSG_MINUTE) || 10;

      const { data } = await this.supabase
        .from('rate_limits')
        .select('request_count')
        .eq('phone_number', phone)
        .eq('minute_key', minuteKey)
        .single();

      if (data && data.request_count >= maxPerMinute) {
        return false;
      }

      // Insérer ou incrémenter
      await this.supabase
        .from('rate_limits')
        .upsert({
          phone_number: phone,
          minute_key: minuteKey,
          request_count: (data?.request_count || 0) + 1
        }, { onConflict: 'phone_number,minute_key' });

      return true;
    } catch (error) {
      return true; // En cas d'erreur, autoriser
    }
  }
}

module.exports = DatabaseService;
