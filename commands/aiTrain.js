const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { getPrefix } = require('./prefixCommand');
const { AiTrainProduct, getTotalProductCount } = require('../utils/mongooseUtil');

// Maps to track users waiting for input
const usersWaitingForProductInfo = new Map();
const usersWaitingForRemoveSelection = new Map();

/**
 * Refactors user-provided product info into a professional, marketing-styled format using OpenRouter API
 * @param {string} productName - The product name
 * @param {string} userInfo - The raw user input about the product
 * @returns {Promise<string>} - The refactored description
 */
async function refactorProductInfo(productName, userInfo) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: 'You are a marketing expert. Refactor the provided product information into a structured, professional, and persuasive marketing description. Organize it into sections like: Overview, Unique Features, Strengths, Weaknesses, Comparisons, and Sales Promotion Tips. Make it engaging, concise, and ready for sales use.'
          },
          {
            role: 'user',
            content: `Product Name: ${productName}\n\nUser Info: ${userInfo}\n\nRefactor this into a professional marketing description.`
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
    throw new Error('Failed to refactor product info. Please try again later.');
  }
}

/**
 * Handles the initial !aitrain <product-name> command
 * @param {Object} message - The Discord message object
 * @returns {Promise<Object>} - Info for waiting state
 */
async function handleAiTrainCommand(message) {
  const prefix = await getPrefix(message.guild?.id);
  const args = message.content.slice(`${prefix}aitrain`.length).trim().split(/\s+/);
  const productName = args.join(' ').trim();

  if (!productName) {
    return message.reply(`Please provide a product name. Usage: \`${prefix}aitrain <product-name>\``);
  }

  const totalProducts = await getTotalProductCount();
  if (totalProducts >= 5) {
    return message.reply('Global limit reached: Only 5 products can be stored at a time. Use `!aitrain remove` to free up space.');
  }

  const embed = new EmbedBuilder()
    .setColor('#3498db')
    .setTitle(`Product Info for "${productName}"`)
    .setDescription('Please provide detailed information about the product in your next message. Include:\n• What it offers\n• What\'s unique\n• Strengths and weaknesses\n• Comparisons to similar products\n• Anything a salesperson would need to promote it\n\nAim for at least 100 words for best results.');

  const infoMessage = await message.reply({ embeds: [embed] });
  return { productName, infoMessage, prefix };
}

/**
 * Handles the !aitrain remove command
 * @param {Object} message - The Discord message object
 * @returns {Promise<Object>} - Info for waiting state
 */
async function handleAiTrainRemoveCommand(message) {
  const products = await AiTrainProduct.find({});
  if (products.length === 0) {
    return message.reply('No products stored to remove.');
  }

  const productList = products.map((p, i) => `${i + 1}. ${p.productName} (Owner: <@${p.ownerId}>)`).join('\n');
  const embed = new EmbedBuilder()
    .setColor('#e74c3c')
    .setTitle('Select Product to Remove')
    .setDescription(`Reply with the number of the product to remove:\n${productList}`);

  const selectMessage = await message.reply({ embeds: [embed] });
  return { products, selectMessage };
}

/**
 * Processes user-provided product info, refactors it, and stores in DB
 * @param {string} userId - The user ID
 * @param {Object} trainData - Data from initial command
 * @param {string} userInfo - The user's product info
 * @param {Object} message - The Discord message object
 */
async function handleProductInfoInput(userId, trainData, userInfo, message) {
  const { productName, infoMessage, prefix } = trainData;

  if (userInfo.split(/\s+/).length < 20) {
    await infoMessage.edit('Your response is too short. Please provide at least 100 words of detailed product information.');
    return;
  }

  await infoMessage.edit(`Refactoring and storing information for "${productName}"...`);

  try {
    const refactoredDescription = await refactorProductInfo(productName, userInfo);
    const totalProducts = await getTotalProductCount();

    if (totalProducts >= 5) {
      await infoMessage.edit('Global limit reached while processing. Product not stored.');
      return;
    }

    await AiTrainProduct.create({
      productName,
      ownerId: userId,
      refactoredDescription
    });

    const embed = new EmbedBuilder()
      .setColor('#27ae60')
      .setTitle(`Product "${productName}" Stored`)
      .setDescription('Your product information has been refactored and stored successfully!')
      .addFields({ name: 'Refactored Description', value: refactoredDescription.substring(0, 1000) + '...' });

    await message.channel.send({ embeds: [embed] });
    await infoMessage.edit(`✅ Product "${productName}" stored. Use \`${prefix}aitrain remove\` to manage products.`);
  } catch (error) {
    await infoMessage.edit('Failed to process and store product info. Please try again.');
  }

  usersWaitingForProductInfo.delete(userId);
}

/**
 * Handles removal selection
 * @param {string} userId - The user ID
 * @param {Object} removeData - Data from remove command
 * @param {string} selection - The user's selection
 * @param {Object} message - The Discord message object
 */
async function handleRemoveSelection(userId, removeData, selection, message) {
  const { products, selectMessage } = removeData;
  const index = parseInt(selection.trim()) - 1;

  if (isNaN(index) || index < 0 || index >= products.length) {
    await selectMessage.edit('Invalid selection. Please reply with a valid number.');
    return;
  }

  const product = products[index];
  if (product.ownerId !== userId) {
    await selectMessage.edit('You can only remove products you own.');
    return;
  }

  await AiTrainProduct.deleteOne({ _id: product._id });
  await selectMessage.edit(`✅ Product "${product.productName}" removed successfully.`);
  usersWaitingForRemoveSelection.delete(userId);
}

module.exports = {
  handleAiTrainCommand,
  handleAiTrainRemoveCommand,
  handleProductInfoInput,
  handleRemoveSelection,
  usersWaitingForProductInfo,
  usersWaitingForRemoveSelection
};
