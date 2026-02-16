# 🤖 WhatsApp Bot avec IA

Bot WhatsApp intelligent utilisant OpenRouter pour l'IA et Supabase pour la persistance.

## 📋 Fonctionnalités

- ✅ Connexion WhatsApp via QR Code
- ✅ Réponses IA avec OpenRouter (Claude, GPT, etc.)
- ✅ Historique des conversations (Supabase)
- ✅ Protection anti-flood (Rate Limiting)
- ✅ Système de blacklist
- ✅ Gestion des erreurs robuste
- ✅ Logs professionnels

## 🚀 Installation

### 1. Prérequis

- Node.js 18+
- Compte OpenRouter (https://openrouter.ai)
- Projet Supabase (https://supabase.com)

### 2. Installation des dépendances

```bash
npm install
```

### 3. Configuration

Renommez `.env.example` en `.env` et configurez:

```env
OPENROUTER_API_KEY=sk-or-v1-xxxxx
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJxxxxx
```

### 4. Schema Supabase

Exécutez ce SQL dans Supabase:

```sql
-- Table des messages
CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY,
  phone_number TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table blacklist
CREATE TABLE blacklist (
  id BIGSERIAL PRIMARY KEY,
  phone_number TEXT UNIQUE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour performance
CREATE INDEX idx_messages_phone ON messages(phone_number);
CREATE INDEX idx_messages_created ON messages(created_at);
```

### 5. Démarrage

```bash
# Mode développement
npm run dev

# Mode production
npm start

# Avec PM2 (recommandé)
npm run pm2
```

## 📁 Structure du projet

```
whatsapp-bot/
├── index.js              # Point d'entrée
├── package.json          # Dépendances
├── .env                  # Variables d'environnement
├── ecosystem.config.js   # Config PM2
├── auth_info/            # Credentials WhatsApp
└── src/
    ├── services/
    │   ├── whatsapp.js   # Service WhatsApp
    │   ├── ai.js         # Service IA
    │   ├── database.js   # Service DB
    │   └── security.js   # Service sécurité
    └── utils/
        ├── queue.js      # Queue IA
        └── logger.js     # Logger
```

## 🔧 Configuration avancée

### Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| OPENROUTER_API_KEY | Clé API OpenRouter | - |
| OPENROUTER_MODEL | Modèle IA à utiliser | claude-3.5-sonnet |
| SUPABASE_URL | URL du projet Supabase | - |
| SUPABASE_ANON_KEY | Clé anonyme Supabase | - |
| RATE_LIMIT_MAX | Messages max par fenêtre | 10 |
| RATE_LIMIT_WINDOW | Fenêtre en ms | 60000 |
| BLACKLIST_ENABLED | Activer la blacklist | true |

## 📝 License

MIT © 2024
