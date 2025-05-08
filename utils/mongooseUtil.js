const mongoose = require('mongoose');

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

// Initialize models
const FinanceChannel = mongoose.model('FinanceChannel', financeChannelSchema);
const FinanceAnalysis = mongoose.model('FinanceAnalysis', financeAnalysisSchema);

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
  FinanceAnalysis
};
