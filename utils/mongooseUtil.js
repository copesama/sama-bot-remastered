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
    default: Date.now,
    expires: '7d' // Automatically delete games after 7 days
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
  
  // Critical fix: Temporarily protect script content before sanitization
  const scriptPlaceholders = [];
  let protectedHtml = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (match, scriptContent, index) => {
    const placeholder = `SCRIPT_PLACEHOLDER_${scriptPlaceholders.length}`;
    scriptPlaceholders.push({
      placeholder,
      original: match,
      content: scriptContent
    });
    return placeholder;
  });
  
  const sanitized = sanitizeHtml(protectedHtml, {
    allowedTags: [
      // Standard HTML structure
      'html', 'head', 'body', 'title', 'meta', 'style', 'script', 'link',
      // Block elements
      'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'section', 'article', 
      'header', 'footer', 'nav', 'aside', 'main',
      // Inline elements
      'span', 'button', 'a', 'img', 'canvas', 'audio', 'source', 'br', 'hr',
      'i', 'b', 'strong', 'em', 'small', 'label', 'code', 'pre',
      // Form elements
      'form', 'input', 'select', 'option', 'textarea', 'fieldset', 'legend',
      // Media elements
      'video', 'track', 'svg', 'path', 'rect', 'circle', 'polygon'
    ],
    allowedAttributes: {
      '*': [
        // Common attributes
        'id', 'class', 'style', 'name', 'value', 'type', 'placeholder',
        'title', 'alt', 'width', 'height', 'src', 'href', 'target', 
        // Event handlers (essential for games)
        'onclick', 'onmouseover', 'onmouseout', 'onmousemove', 'onkeydown', 
        'onkeyup', 'onkeypress', 'onload', 'onunload', 'onchange', 'onfocus',
        'onblur', 'ontouchstart', 'ontouchmove', 'ontouchend', 'ontouchcancel',
        'draggable', 'contenteditable'
      ],
      'meta': ['charset', 'content', 'name', 'http-equiv'],
      'script': ['type', 'src', 'async', 'defer'],
      'link': ['rel', 'href', 'type'],
      'source': ['src', 'type'],
      'img': ['src', 'alt', 'width', 'height', 'loading', 'srcset', 'sizes'],
      'a': ['href', 'target', 'rel', 'download', 'hreflang'],
      'input': ['type', 'name', 'value', 'checked', 'disabled', 'placeholder', 'readonly', 'required', 'min', 'max', 'step'],
      'select': ['name', 'disabled', 'required', 'multiple', 'size'],
      'option': ['value', 'selected', 'disabled'],
      'textarea': ['name', 'disabled', 'readonly', 'required', 'rows', 'cols', 'placeholder'],
      'form': ['action', 'method', 'enctype', 'target', 'novalidate'],
      'canvas': ['width', 'height'],
      'audio': ['controls', 'autoplay', 'loop', 'muted', 'preload', 'src'],
      'video': ['controls', 'autoplay', 'loop', 'muted', 'preload', 'src', 'poster', 'width', 'height'],
      'svg': ['viewBox', 'width', 'height', 'xmlns', 'fill', 'stroke'],
      'path': ['d', 'fill', 'stroke', 'stroke-width', 'transform']
    },
    allowedSchemes: ['http', 'https', 'data', 'mailto', 'tel'],
    allowedScriptDomains: ['none'], // Allow inline scripts
    allowedStyleDomains: ['none'],  // Allow inline styles
    // Allow inline styles and scripts for game functionality
    allowVulnerableTags: true,
    allowedScriptTypes: ['text/javascript', 'application/javascript'],
    // Remove script from nonTextTags
    nonTextTags: ['style', 'textarea', 'option', 'noscript'],
    // Additional options for games
    parser: {
      lowerCaseTags: false, // Preserve tag casing
      lowerCaseAttributeNames: false // Preserve attribute casing
    }
  });
  
  // Restore script tags with their original content
  let finalHtml = sanitized;
  scriptPlaceholders.forEach(({placeholder, original}) => {
    finalHtml = finalHtml.replace(placeholder, original);
  });
  
  return finalHtml;
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