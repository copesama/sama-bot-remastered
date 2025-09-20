const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { MarketingProduct } = require('../utils/mongooseUtil');

// Maps to track users waiting for responses
const usersWaitingForMarketingInfo = new Map();
const usersWaitingForMarketingRemove = new Map();

/**
 * Handles the initial !marketing <product-name> command
 * @param {Object} message - The Discord message object
 * @param {string} productName - The product name from the command
 * @returns {Promise<Object>} - Information about the waiting state
 */
async function handleMarketingCommand(message, productName) {
  try {
    // Check global product limit
    const productCount = await MarketingProduct.countDocuments();
    if (productCount >= 5) {
      return message.reply('Sorry, the global limit of 5 products has been reached. Please use `!marketing remove` to free up space.');
    }

    // Check if product name already exists
    const existingProduct = await MarketingProduct.findOne({ productName });
    if (existingProduct) {
      return message.reply(`A product named "${productName}" already exists. Please choose a different name.`);
    }

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(`Marketing Info for ${productName}`)
      .setDescription('Please provide detailed information about your product in your next message. Include:\n- What it offers\n- What\'s unique about it\n- Strengths and weaknesses\n- Comparison to similar products\n- Anything a salesperson would need to promote it\n\nAim for at least 100 words for best results.')
      .setFooter({ text: 'Reply with your product details' });

    const sentMessage = await message.reply({ embeds: [embed] });

    // Return data to set up waiting state
    return { productName, sentMessage };
  } catch (error) {
    message.reply('Sorry, there was an error starting the marketing process. Please try again later.');
    return null;
  }
}

/**
 * Handles the user's product info input
 * @param {string} userId - The Discord user ID
 * @param {Object} marketingData - Data containing productName and sentMessage
 * @param {string} userInfo - The user's product info
 * @param {Object} message - The Discord message object
 * @returns {Promise<boolean>} - Whether the processing was successful
 */
async function handleMarketingInfoInput(userId, marketingData, userInfo, message) {
  const { productName, sentMessage } = marketingData;

  // Validate input length
  const wordCount = userInfo.split(/\s+/).length;
  if (wordCount < 50) {
    await sentMessage.edit(`Your response was only ${wordCount} words. Please provide at least 50 words for better results.`);
    return false;
  }

  await sentMessage.edit(`Processing your marketing info for "${productName}"... This might take a moment.`);

  try {
    const structuredInfo = await refactorMarketingInfo(productName, userInfo);

    // Store in DB
    const newProduct = new MarketingProduct({
      productName,
      ownerId: userId,
      structuredInfo
    });
    await newProduct.save();

    const successEmbed = new EmbedBuilder()
      .setColor('#27ae60')
      .setTitle(`Marketing Profile Created for ${productName}`)
      .setDescription('Your product has been successfully stored with a professional marketing structure!')
      .setFooter({ text: 'Use !marketing remove to manage your products' });

    await message.channel.send({ embeds: [successEmbed] });
    await sentMessage.edit(`✅ Marketing profile for "${productName}" created and stored!`);

    // Remove from waiting
    usersWaitingForMarketingInfo.delete(userId);
    return true;
  } catch (error) {
    await sentMessage.edit(`Sorry, there was an error processing your marketing info for "${productName}". Please try again later.`);
    usersWaitingForMarketingInfo.delete(userId);
    return false;
  }
}

/**
 * Refactors user-provided product info into structured marketing style using OpenRouter API
 * @param {string} productName - The product name
 * @param {string} userInfo - The raw user input
 * @returns {Promise<string>} - The refactored marketing info
 */
async function refactorMarketingInfo(productName, userInfo) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: 'You are a marketing expert. Refactor the provided product information into a structured, professional marketing profile. Use bullet points, persuasive language, and sales-oriented formatting. Highlight strengths, address weaknesses tactfully, and make it ready for promotion. Keep it concise but comprehensive.'
          },
          {
            role: 'user',
            content: `Refactor the following product information for "${productName}" into a professional marketing structure:\n\n${userInfo}`
          }
        ],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    return response.data.choices[0].message.content.trim();
  } catch (error) {
    throw new Error('Failed to refactor marketing info. Please try again later.');
  }
}

/**
 * Handles the !marketing remove command
 * @param {Object} message - The Discord message object
 * @returns {Promise<Object>} - Information about the waiting state
 */
async function handleMarketingRemoveCommand(message) {
  try {
    const userProducts = await MarketingProduct.find({ ownerId: message.author.id });
    if (userProducts.length === 0) {
      return message.reply('You don\'t have any stored products to remove.');
    }

    const productList = userProducts.map(p => `- ${p.productName}`).join('\n');
    const embed = new EmbedBuilder()
      .setColor('#e74c3c')
      .setTitle('Select Product to Remove')
      .setDescription(`Your products:\n${productList}\n\nReply with the exact product name to remove it.`)
      .setFooter({ text: 'Reply with the product name' });

    const sentMessage = await message.reply({ embeds: [embed] });

    // Return data to set up waiting state
    return { userProducts, sentMessage };
  } catch (error) {
    message.reply('Sorry, there was an error retrieving your products. Please try again later.');
    return null;
  }
}

/**
 * Handles the user's selection for product removal
 * @param {string} userId - The Discord user ID
 * @param {Object} removeData - Data containing userProducts and sentMessage
 * @param {string} selection - The selected product name
 * @param {Object} message - The Discord message object
 * @returns {Promise<boolean>} - Whether the removal was successful
 */
async function handleMarketingRemoveSelection(userId, removeData, selection, message) {
  const { userProducts, sentMessage } = removeData;

  const productToRemove = userProducts.find(p => p.productName === selection);
  if (!productToRemove) {
    await sentMessage.edit('Invalid product name. Please try `!marketing remove` again.');
    return false;
  }

  try {
    await MarketingProduct.deleteOne({ _id: productToRemove._id });
    await sentMessage.edit(`✅ Product "${selection}" has been removed successfully!`);
    usersWaitingForMarketingRemove.delete(userId);
    return true;
  } catch (error) {
    await sentMessage.edit(`Sorry, there was an error removing "${selection}". Please try again later.`);
    usersWaitingForMarketingRemove.delete(userId);
    return false;
  }
}

module.exports = {
  handleMarketingCommand,
  handleMarketingInfoInput,
  handleMarketingRemoveCommand,
  handleMarketingRemoveSelection,
  usersWaitingForMarketingInfo,
  usersWaitingForMarketingRemove
};
