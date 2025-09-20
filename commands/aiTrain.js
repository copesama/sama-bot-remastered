const axios = require('axios');
const { Product } = require('../utils/mongooseUtil');
const { EmbedBuilder } = require('discord.js');

/**
 * Refactors raw product info into structured marketing JSON using OpenRouter API
 * @param {string} rawInfo - User-provided product information
 * @param {string} productName - Name of the product
 * @returns {Object} - Structured product data
 */
async function refactorProductInfo(rawInfo, productName) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: `You are a professional marketing expert. Refactor the provided raw product information into structured, professional marketing content.

Output EXACTLY in this JSON format (no additional text):
{
  "overview": "Brief professional overview of the product",
  "features": ["List of key features"],
  "uniqueAspects": ["What makes it unique"],
  "strengths": ["Key strengths for sales"],
  "weaknesses": ["Honest weaknesses (keep minimal and constructive)"],
  "comparisons": "Comparison to 2-3 similar products",
  "salesPitch": "Compelling sales script for a salesperson"
}

Ensure content is engaging, factual, and optimized for sales promotion. Base it strictly on the provided info.`
          },
          {
            role: 'user',
            content: `Product: ${productName}\nRaw info: ${rawInfo}`
          }
        ],
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0].message.content;
    let structuredData;
    try {
      structuredData = JSON.parse(content);
    } catch (e) {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      structuredData = jsonMatch ? JSON.parse(jsonMatch[1]) : JSON.parse(content.match(/\[\s*\{[\s\S]*\}\s*\]/)?.[0] || '{}');
    }

    // Validate structure
    if (!structuredData.overview || !Array.isArray(structuredData.features)) {
      throw new Error('Invalid structure from API');
    }

    return structuredData;
  } catch (error) {
    throw new Error('Failed to refactor product info');
  }
}

/**
 * Handles the !aitrain command initiation
 * @param {Object} message - Discord message
 * @param {string} productName - Product name from command
 * @param {Map} waitingMap - Global map for waiting users
 */
async function handleAitrainCommand(message, productName, waitingMap) {
  // Check if product already exists
  const existing = await Product.findOne({ productName });
  if (existing) {
    return message.reply(`❌ Product "${productName}" already exists. Use \`!aitrain remove\` to delete it first.`);
  }

  // Check total count
  const total = await Product.countDocuments();
  if (total >= 5) {
    return message.reply('❌ Maximum of 5 products reached. Use \`!aitrain remove\` to free up space.');
  }

  waitingMap.set(message.author.id, { productName, stage: 'info' });
  return message.reply(`📝 Product training initiated for "${productName}".\n\nPlease reply with details about the product: what it offers, unique features, strengths, weaknesses, comparisons to similar products, and any sales info.`);
}

/**
 * Processes user input for product info
 * @param {Object} message - Discord message
 * @param {Map} waitingMap - Global map for waiting users
 */
async function handleAitrainInput(message, waitingMap) {
  const userId = message.author.id;
  const data = waitingMap.get(userId);
  if (!data || data.stage !== 'info') return;

  const { productName } = data;
  const rawInfo = message.content.trim();

  if (rawInfo.length < 50) {
    return message.reply('❌ Please provide more detailed information (at least 50 characters).');
  }

  try {
    await message.delete().catch(() => {}); // Clean up input message

    const loadingMsg = await message.channel.send(`🔄 Refactoring "${productName}" info...`);
    const structuredData = await refactorProductInfo(rawInfo, productName);

    // Store in DB
    const product = new Product({
      productName,
      ownerId: userId,
      productData: structuredData
    });
    await product.save();

    waitingMap.delete(userId);

    const embed = new EmbedBuilder()
      .setTitle(`✅ "${productName}" Training Complete!`)
      .setDescription('Your product data has been stored and refactored for sales use.')
      .addFields(
        { name: 'Overview', value: structuredData.overview, inline: false },
        { name: 'Key Features', value: structuredData.features.slice(0, 3).join('\n'), inline: false },
        { name: 'Unique Aspects', value: structuredData.uniqueAspects.join('\n'), inline: false },
        { name: 'Sales Pitch', value: structuredData.salesPitch.substring(0, 500) + '...', inline: false }
      )
      .setColor('#4CAF50')
      .setFooter({ text: 'Use !aitrain remove to manage products.' });

    await loadingMsg.edit({ content: `<@${userId}>`, embeds: [embed] });
  } catch (error) {
    waitingMap.delete(userId);
    console.error('Aitrain error:', error);
    await message.reply('❌ Failed to process product info. Please try again.');
  }
}

/**
 * Handles the !aitrain remove command
 * @param {Object} message - Discord message
 * @param {Map} waitingMap - Global map for waiting users
 */
async function handleAitrainRemoveCommand(message, waitingMap) {
  const products = await Product.find({}).sort({ createdAt: -1 });
  if (products.length === 0) {
    return message.reply('ℹ️ No products stored yet.');
  }

  const embed = new EmbedBuilder()
    .setTitle('🗑️ Select Product to Remove')
    .setDescription('Reply with the number (1-' + products.length + ') of the product you own.')
    .setColor('#FF9800');

  products.forEach((p, i) => {
    embed.addFields({ name: `${i + 1}. ${p.productName}`, value: `Owner: <@${p.ownerId}>`, inline: false });
  });

  await message.reply({ embeds: [embed] });
  waitingMap.set(message.author.id, { stage: 'remove', products });
}

/**
 * Processes removal choice
 * @param {Object} message - Discord message
 * @param {Map} waitingMap - Global map for waiting users
 */
async function handleAitrainRemoveInput(message, waitingMap) {
  const userId = message.author.id;
  const data = waitingMap.get(userId);
  if (!data || data.stage !== 'remove') return;

  const { products } = data;
  const choice = parseInt(message.content.trim());
  if (isNaN(choice) || choice < 1 || choice > products.length) {
    return message.reply(`❌ Invalid choice. Must be 1-${products.length}.`);
  }

  const selected = products[choice - 1];
  if (selected.ownerId !== userId) {
    return message.reply('❌ You can only remove your own products.');
  }

  try {
    await Product.deleteOne({ _id: selected._id });
    waitingMap.delete(userId);
    await message.delete().catch(() => {});
    return message.channel.send(`✅ "${selected.productName}" removed successfully.`);
  } catch (error) {
    console.error('Remove error:', error);
    await message.reply('❌ Failed to remove product.');
  }
}

module.exports = {
  handleAitrainCommand,
  handleAitrainInput,
  handleAitrainRemoveCommand,
  handleAitrainRemoveInput
};
