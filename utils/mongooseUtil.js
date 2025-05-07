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

// Initialize models
const FinanceChannel = mongoose.model('FinanceChannel', financeChannelSchema);

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
  FinanceChannel
};
