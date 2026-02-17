// ===== LOGGER SIMPLE =====
// Logger sans dépendance externe pino-pretty

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function getTimestamp() {
  return new Date().toLocaleTimeString('fr-FR', { 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

const logger = {
  info: (...args) => {
    console.log(`${colors.cyan}[${getTimestamp()}]${colors.reset} ${colors.green}INFO:${colors.reset}`, ...args);
  },
  
  warn: (...args) => {
    console.log(`${colors.cyan}[${getTimestamp()}]${colors.reset} ${colors.yellow}WARN:${colors.reset}`, ...args);
  },
  
  error: (...args) => {
    console.log(`${colors.cyan}[${getTimestamp()}]${colors.reset} ${colors.red}ERROR:${colors.reset}`, ...args);
  },
  
  debug: (...args) => {
    if (process.env.DEBUG === 'true') {
      console.log(`${colors.cyan}[${getTimestamp()}]${colors.reset} ${colors.magenta}DEBUG:${colors.reset}`, ...args);
    }
  }
};

module.exports = { logger };
