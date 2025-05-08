const mongoose = require('mongoose');
const sanitizeHtml = require('sanitize-html'); // Add this dependency

/**
 * Finance channel schema - stores subscribed Discord channels for finance updates
 */
const financeChannelSchema = new mongoose.Schema({
  guildId: { 
    type: String, 
    required: true,
    unique: true,
    index: true
  },
  channelId: { 
    type: String, 
    required: true 
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the timestamp when document is updated
financeChannelSchema.pre('updateOne', function() {
  this.set({ updatedAt: new Date() });
});

/**
 * Finance analysis schema - stores AI-generated financial analysis
 */
const financeAnalysisSchema = new mongoose.Schema({
  content: {
    type: String,
    required: true
  },
  stocks: {
    type: [String], // Array of stock tickers
    default: []
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '7d' // Automatically delete after 7 days
  }
});

/**
 * Game schema - stores HTML games
 */
const gameSchema = new mongoose.Schema({
  gameId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  html: {
    type: String,
    required: true
  },
  prompt: {
    type: String,
    required: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  // Adding a security flag to track sanitized games
  isSanitized: {
    type: Boolean,
    default: false
  }
});

// Update the timestamp when document is updated
gameSchema.pre('updateOne', function() {
  this.set({ updatedAt: new Date() });
});

// Simple HTML sanitizer function to use in templates
function sanitizeHtmlForTemplate(html) {
  if (!html) return '';
  
  return html
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Add a more robust HTML sanitizer for game content
function sanitizeGameHtml(html) {
  if (!html) return '';
  
  return sanitizeHtml(html, {
    allowedTags: [
      'html', 'head', 'body', 'title', 'meta', 'style', 'script', 'link',
      'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'span', 'button', 'a', 'img', 'canvas', 'audio', 'source', 'br'
    ],
    allowedAttributes: {
      '*': ['id', 'class', 'style'],
      'a': ['href', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height'],
      'meta': ['charset', 'content', 'name'],
      'script': ['type'],
      'link': ['rel', 'href', 'type'],
      'source': ['src', 'type'],
      'canvas': ['width', 'height'],
      'audio': ['controls']
    },
    allowedSchemes: ['http', 'https', 'data', 'mailto'],
    allowedScriptDomains: ['none'],
    allowedStyleDomains: ['none'],
    // Allow inline styles and scripts for game functionality
    allowVulnerableTags: true,
    allowedScriptTypes: ['text/javascript', 'application/javascript']
  });
}

// Initialize models
const FinanceChannel = mongoose.model('FinanceChannel', financeChannelSchema);
const FinanceAnalysis = mongoose.model('FinanceAnalysis', financeAnalysisSchema);
const Game = mongoose.model('Game', gameSchema);

/**
 * Connect to MongoDB
 * @returns {Promise} MongoDB connection
 */
const connectToDatabase = async () => {
  try {
    if (mongoose.connection.readyState === 1) {
      // Already connected
      return mongoose.connection;
    }

    const connectionString = process.env.MONGODB_URI;
    if (!connectionString) {
      throw new Error('MongoDB connection string not found in environment variables');
    }

    await mongoose.connect(connectionString, {});
    
    console.log('Connected to MongoDB');
    return mongoose.connection;
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
};

module.exports = {
  connectToDatabase,
  FinanceChannel,
  FinanceAnalysis,
  Game,
  sanitizeHtmlForTemplate,
  sanitizeGameHtml
};