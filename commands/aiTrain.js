const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getPrefix } = require('./prefixCommand');

// Maps to track users waiting for product info or removal selection
const usersWaitingForProductInfo = new Map();
const usersWaitingForRemovalSelection = new Map();

/**
 * Refactors user-provided product info into a structured, professional, marketing-styled format using OpenRouter API
 * @param {string} productName - The product name
 * @param {string} userInfo - The raw user input about the product
 * @returns {Promise<string>} - The refactored, structured product info
 */
async function refactorProductInfo(productName, userInfo) {
  console.log(`[DEBUG] Refactoring product info for: ${productName}`);
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: 'You are a marketing expert. Refactor the provided product information into a structured, professional, and marketing-styled format. Organize it into clear sections like: What It Offers, What Makes It Unique, Strengths, Weaknesses, Comparison to Similar Products, and Sales Promotion Tips. Make it persuasive, concise, and ready for sales use. Maintain the original language and key details.'
          },
          {
            role: 'user',
            content: `Product Name: ${productName}\n\nUser Info: ${userInfo}\n\nPlease refactor this into a structured marketing format.`
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
    console.error('[DEBUG] Error in refactorProductInfo:', error.message);
    throw new Error('Failed to refactor product info. Please try again later.');
  }
}

/**
 * Handles the initial !aitrain command
 * @param {Object} message - The Discord message object
 * @param {string} subCommand - 'add' or 'remove' based on args
 * @param {string} productName - The product name (for add)
 * @returns {Promise<Object|null>} - Info for waiting state or null on error
 */
async function handleAiTrainCommand(message, subCommand, productName) {
  console.log(`[DEBUG] Handling !aitrain command: subCommand=${subCommand}, productName=${productName}`);
  const prefix = await getPrefix(message.guild?.id);

  if (subCommand === 'remove') {
    console.log('[DEBUG] Handling remove subcommand');
    // Query products owned by the user
    const { AiTrainProduct } = require('../utils/mongooseUtil');
    const userProducts = await AiTrainProduct.find({ ownerId: message.author.id });
    if (userProducts.length === 0) {
      return message.reply(`You have no products stored. Use \`${prefix}aitrain <product-name>\` to add one.`);
    }

    // List products for selection
    const productList = userProducts.map((p, i) => `${i + 1}. ${p.productName}`).join('\n');
    const embed = new EmbedBuilder()
      .setColor('#f39c12')
      .setTitle('Select Product to Remove')
      .setDescription(`Your stored products:\n${productList}\n\nReply with the number of the product to remove.`)
      .setFooter({ text: 'Type a number (e.g., 1) in your next message' });

    const selectionMessage = await message.reply({ embeds: [embed] });
    return { selectionMessage, userProducts };
  } else if (productName) {
    console.log('[DEBUG] Handling add product:', productName);
    // Check global limit
    const { AiTrainProduct } = require('../utils/mongooseUtil');
    const totalProducts = await AiTrainProduct.countDocuments();
    if (totalProducts >= 5) {
      return message.reply('Global limit reached: Only 5 products can be stored at a time. Use `!aitrain remove` to free up space.');
    }

    // Ask for product info
    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle(`Add Product: ${productName}`)
      .setDescription('Please provide detailed info about the product, including:\n• What it offers\n• What makes it unique\n• Strengths and weaknesses\n• Comparison to similar products\n• Anything a salesperson would need to promote it\n\nWrite at least 100 words for best results.')
      .setFooter({ text: 'Reply with your product info in the next message' });

    const infoMessage = await message.reply({ embeds: [embed] });
    return { productName, infoMessage, prefix };
  } else {
    console.log('[DEBUG] No valid args, sending usage');
    return message.reply(`Usage: \`${prefix}aitrain <product-name>\` to add, or \`${prefix}aitrain remove\` to remove.`);
  }
}

/**
 * Handles user's product info input
 * @param {string} userId - The Discord user ID
 * @param {Object} trainData - Data from waiting state
 * @param {string} userInfo - The user's product info
 * @param {Object} message - The Discord message object
 * @returns {Promise<boolean>} - Success status
 */
async function handleProductInfoInput(userId, trainData, userInfo, message) {
  console.log(`[DEBUG] Handling product info input for user: ${userId}`);
  const { productName, infoMessage, prefix } = trainData;

  if (userInfo.split(/\s+/).length < 25) { // ~100 words minimum
    await infoMessage.edit('Your response is too short. Please provide at least 100 words of detailed product info.');
    return false;
  }

  await infoMessage.edit(`Refactoring and storing info for "${productName}"... This may take a moment.`);

  try {
    const refactoredInfo = await refactorProductInfo(productName, userInfo);

    // Store in DB
    const { AiTrainProduct } = require('../utils/mongooseUtil');
    const newProduct = new AiTrainProduct({
      productName,
      ownerId: userId,
      refactoredInfo,
      createdAt: new Date()
    });
    await newProduct.save();

    const embed = new EmbedBuilder()
      .setColor('#27ae60')
      .setTitle(`Product Stored: ${productName}`)
      .setDescription('Your product info has been refactored and stored successfully!')
      .addFields(
        { name: 'Refactored Info Preview', value: refactoredInfo.substring(0, 500) + '...' },
        { name: 'Next Steps', value: `Use \`${prefix}aitrain remove\` to manage your products.` }
      );

    await message.channel.send({ embeds: [embed] });
    usersWaitingForProductInfo.delete(userId);
    return true;
  } catch (error) {
    console.error('[DEBUG] Error storing product:', error.message);
    await infoMessage.edit(`Error storing product: ${error.message}`);
    usersWaitingForProductInfo.delete(userId);
    return false;
  }
}

/**
 * Handles user's removal selection
 * @param {string} userId - The Discord user ID
 * @param {Object} removalData - Data from waiting state
 * @param {string} selection - The user's selection (number)
 * @param {Object} message - The Discord message object
 * @returns {Promise<boolean>} - Success status
 */
async function handleRemovalSelection(userId, removalData, selection, message) {
  console.log(`[DEBUG] Handling removal selection for user: ${userId}, selection: ${selection}`);
  const { selectionMessage, userProducts } = removalData;
  const index = parseInt(selection.trim(), 10) - 1;

  if (isNaN(index) || index < 0 || index >= userProducts.length) {
    await selectionMessage.edit('Invalid selection. Please reply with a valid number.');
    return false;
  }

  const productToRemove = userProducts[index];
  const { AiTrainProduct } = require('../utils/mongooseUtil');
  await AiTrainProduct.deleteOne({ _id: productToRemove._id });

  const embed = new EmbedBuilder()
    .setColor('#e74c3c')
    .setTitle('Product Removed')
    .setDescription(`Successfully removed "${productToRemove.productName}".`);

  await message.channel.send({ embeds: [embed] });
  usersWaitingForRemovalSelection.delete(userId);
  return true;
}

module.exports = {
  handleAiTrainCommand,
  handleProductInfoInput,
  handleRemovalSelection,
  usersWaitingForProductInfo,
  usersWaitingForRemovalSelection
};
