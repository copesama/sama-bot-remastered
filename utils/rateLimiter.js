/**
 * A utility for rate-limiting commands per server and per user
 */

// Stores the current usage counts for each command in each server
const usageCounts = new Map();
// Stores the current usage counts for each command for each user
const userUsageCounts = new Map();

// Default limit configurations for commands (server-based)
const defaultLimits = {
  'singlegame': { limit: 11, resetIntervalHours: 24 },
  'multigame': { limit: 1000, resetIntervalHours: 24 },
  'story': { limit: 6, resetIntervalHours: 24 },
  'image': { limit: 21, resetIntervalHours: 24 },
  'music': { limit: 4, resetIntervalHours: 24 },
  'quiz': { limit: 11, resetIntervalHours: 24 },
  'choicesgame': { limit: 11, resetIntervalHours: 24 },
  'financenews': { limit: 1000, resetIntervalHours: 24 },
  'financereport': { limit: 4, resetIntervalHours: 24 },
  'play': { limit: 1000, resetIntervalHours: 24 },
  'edit': { limit: 16, resetIntervalHours: 24 },
  'enhance': { limit: 16, resetIntervalHours: 24 },
  'human': { limit: 16, resetIntervalHours: 24 },
  'aitrain': { limit: 10, resetIntervalHours: 24 },
};

// Default user-specific limits
const defaultUserLimits = {
  'singlegame': { limit: 10, resetIntervalHours: 24 },
  'multigame': { limit: 999, resetIntervalHours: 24 },
  'story': { limit: 5, resetIntervalHours: 24 },
  'image': { limit: 20, resetIntervalHours: 24 },
  'music': { limit: 3, resetIntervalHours: 24 },
  'quiz': { limit: 10, resetIntervalHours: 24 },
  'choicesgame': { limit: 10, resetIntervalHours: 24 },
  'financenews': { limit: 999, resetIntervalHours: 24 },
  'financereport': { limit: 3, resetIntervalHours: 24 },
  'play': { limit: 999, resetIntervalHours: 24 },
  'edit': { limit: 15, resetIntervalHours: 24 },
  'enhance': { limit: 15, resetIntervalHours: 24 },
  'human': { limit: 15, resetIntervalHours: 24 },
  'aitrain': { limit: 5, resetIntervalHours: 24 },
};

/**
 * Check if a command has reached its rate limit for a server
 * @param {string} serverId - The Discord server ID
 * @param {string} commandName - The command name without the prefix (e.g., 'singlegame')
 * @returns {Object} - Result with isLimited flag and remaining count
 */
function checkRateLimit(serverId, commandName) {
  const now = Date.now();
  const limitConfig = defaultLimits[commandName] || { limit: Infinity, resetIntervalHours: 24 };
  
  // Get or create server entry
  if (!usageCounts.has(serverId)) {
    usageCounts.set(serverId, new Map());
  }
  const serverUsage = usageCounts.get(serverId);
  
  // Get or create command entry
  if (!serverUsage.has(commandName)) {
    serverUsage.set(commandName, {
      count: 0,
      resetTime: now + (limitConfig.resetIntervalHours * 60 * 60 * 1000)
    });
  }
  
  const commandUsage = serverUsage.get(commandName);
  
  // Check if we need to reset the counter
  if (now >= commandUsage.resetTime) {
    commandUsage.count = 0;
    commandUsage.resetTime = now + (limitConfig.resetIntervalHours * 60 * 60 * 1000);
  }
  
  // Check if limit is reached
  const isLimited = commandUsage.count >= limitConfig.limit;
  const remaining = Math.max(0, limitConfig.limit - commandUsage.count);
  
  return {
    isLimited,
    remaining,
    limit: limitConfig.limit,
    resetTimeMs: commandUsage.resetTime,
    resetTimeHours: limitConfig.resetIntervalHours
  };
}

/**
 * Check if a command has reached its rate limit for a user
 * @param {string} userId - The Discord user ID
 * @param {string} commandName - The command name without the prefix
 * @returns {Object} - Result with isLimited flag and remaining count
 */
function checkUserRateLimit(userId, commandName) {
  const now = Date.now();
  const limitConfig = defaultUserLimits[commandName] || { limit: Infinity, resetIntervalHours: 24 };
  
  // Get or create user entry
  if (!userUsageCounts.has(userId)) {
    userUsageCounts.set(userId, new Map());
  }
  const userUsage = userUsageCounts.get(userId);
  
  // Get or create command entry
  if (!userUsage.has(commandName)) {
    userUsage.set(commandName, {
      count: 0,
      resetTime: now + (limitConfig.resetIntervalHours * 60 * 60 * 1000)
    });
  }
  
  const commandUsage = userUsage.get(commandName);
  
  // Check if we need to reset the counter
  if (now >= commandUsage.resetTime) {
    commandUsage.count = 0;
    commandUsage.resetTime = now + (limitConfig.resetIntervalHours * 60 * 60 * 1000);
  }
  
  // Check if limit is reached
  const isLimited = commandUsage.count >= limitConfig.limit;
  const remaining = Math.max(0, limitConfig.limit - commandUsage.count);
  
  return {
    isLimited,
    remaining,
    limit: limitConfig.limit,
    resetTimeMs: commandUsage.resetTime,
    resetTimeHours: limitConfig.resetIntervalHours
  };
}

/**
 * Increment the usage count for a command in a server
 * @param {string} serverId - The Discord server ID
 * @param {string} commandName - The command name without the prefix
 */
function incrementUsage(serverId, commandName) {
  if (!usageCounts.has(serverId)) {
    checkRateLimit(serverId, commandName); // This will initialize the structures
  }
  
  const serverUsage = usageCounts.get(serverId);
  const commandUsage = serverUsage.get(commandName);
  
  commandUsage.count += 1;
}

/**
 * Increment the usage count for a command for a user
 * @param {string} userId - The Discord user ID
 * @param {string} commandName - The command name without the prefix
 */
function incrementUserUsage(userId, commandName) {
  if (!userUsageCounts.has(userId)) {
    checkUserRateLimit(userId, commandName); // This will initialize the structures
  }
  
  const userUsage = userUsageCounts.get(userId);
  const commandUsage = userUsage.get(commandName);
  
  commandUsage.count += 1;
}

/**
 * Format a timestamp into a human-readable time
 * @param {number} timestamp - The timestamp in milliseconds
 * @returns {string} - Formatted time string
 */
function formatResetTime(timestamp) {
  const resetDate = new Date(timestamp);
  return resetDate.toLocaleString();
}

module.exports = {
  checkRateLimit,
  checkUserRateLimit,
  incrementUsage,
  incrementUserUsage,
  formatResetTime
};
