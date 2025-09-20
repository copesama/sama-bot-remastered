const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { Product } = require('../utils/mongooseUtil');

// Track users waiting for product info
const usersWaitingForProductInfo = new Map();

// Track users waiting for remove selection
const usersWaitingForRemove = new Map();

/**
 * Generates structured product info using OpenRouter API
 * @param {string} productName Product name
 * @param {string} rawInfo User-provided info
 * @returns {Object} Structured product data
 */
async function generateStructuredProductInfo(productName, rawInfo) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'microsoft/mai-ds-r1:free',
        messages: [
          {
            role: 'system',
            content: `You are a marketing expert. Refactor the provided product info into a structured, professional sales training document.

Output EXACTLY valid JSON in this format:
{
  "productName": "Product Name",
  "overview": "Brief professional overview of what the product offers",
  "uniqueFeatures": ["Feature 1", "Feature 2"],
  "strengths": ["Strength 1", "Strength 2"],
  "weaknesses": ["Weakness 1", "Weakness 2"],
  "comparisons": "Comparison to similar products",
  "salesPitch": "Compelling marketing-style sales pitch",
  "keySellingPoints": ["Point 1", "Point 2"]
}

Requirements:
- Make it marketing-oriented, positive, and persuasive
- Ensure factual based on input
- No additional text outside JSON`
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
      if (jsonMatch) {
        structuredData = JSON.parse(jsonMatch[1]);
      } else {
        throw new Error('Failed to parse structured data');
      }
    }

    if (!structuredData.productName || typeof structuredData.overview !== 'string') {
      throw new Error('Invalid structure from API');
    }

    return structuredData;
  } catch (error) {
    throw error;
  }
}

/**
 * Handles !aitrain <product-name> command
 * @param {Object} message Discord message
 * @param {string} productName Product name
 */
async function handleAitTrainCommand(message, productName) {
  const embed = new EmbedBuilder()
    .setColor('#4285F4')
    .setTitle('AI Train: Product Info Needed')
    .setDescription(`Tell me about "${productName}":\n• What it offers\n• Unique aspects\n• Strengths & weaknesses\n• Comparisons to similar products\n• Sales promotion points\n\nReply with the details.`);
  
  await message.reply({ embeds: [embed] });
  usersWaitingForProductInfo.set(message.author.id, { productName });
}

/**
 * Handles user input for product info
 * @param {Object} message Discord message
 */
async function handleProductInfoInput(message) {
  const userId = message.author.id;
  if (!usersWaitingForProductInfo.has(userId)) return;

  const { productName } = usersWaitingForProductInfo.get(userId);
  const rawInfo = message.content.trim();
  usersWaitingForProductInfo.delete(userId);

  if (rawInfo.length < 10) {
    await message.reply('Please provide more detailed info (at least 10 characters).');
    return;
  }

  await message.delete().catch(() => {});

  const loadingMsg = await message.channel.send(`🔄 Structuring info for "${productName}"...`);
  
  try {
    const totalProducts = await Product.countDocuments();
    if (totalProducts >= 5) {
      await loadingMsg.edit('❌ Max 5 products reached. Use !aitrain remove to free space.');
      return;
    }

    const structuredData = await generateStructuredProductInfo(productName, rawInfo);

    const product = new Product({
      productName,
      structuredData,
      ownerId: userId,
      createdAt: new Date()
    });
    await product.save();

    const embed = new EmbedBuilder()
      .setColor('#4CAF50')
      .setTitle(`✅ "${productName}" Trained!`)
      .setDescription('Structured sales data stored. Total products: ' + (totalProducts + 1) + '/5')
      .addFields({ name: 'Overview', value: structuredData.overview.substring(0, 500) + '...' });
    
    await loadingMsg.edit({ embeds: [embed] });
  } catch (error) {
    console.error('Error processing product:', error);
    await loadingMsg.edit('❌ Error structuring info. Try again.');
  }
}

/**
 * Handles !aitrain remove command
 * @param {Object} message Discord message
 */
async function handleRemoveCommand(message) {
  const products = await Product.find({}, 'productName ownerId createdAt');
  if (products.length === 0) {
    await message.reply('No products stored yet.');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor('#FF9800')
    .setTitle('AI Train: Remove Product')
    .setDescription('Reply with the number of the product to remove (only yours):')
    .addFields(products.map((p, i) => ({
      name: `${i + 1}. ${p.productName}`,
      value: `<@${p.ownerId}> • ${p.createdAt.toLocaleDateString()}`,
      inline: false
    })));

  await message.reply({ embeds: [embed] });
  usersWaitingForRemove.set(message.author.id, products);
}

/**
 * Handles user selection for removal
 * @param {Object} message Discord message
 */
async function handleRemoveSelection(message) {
  const userId = message.author.id;
  if (!usersWaitingForRemove.has(userId)) return;

  const products = usersWaitingForRemove.get(userId);
  const selection = parseInt(message.content.trim());
  usersWaitingForRemove.delete(userId);

  if (isNaN(selection) || selection < 1 || selection > products.length) {
    await message.reply('Invalid selection.');
    await message.delete().catch(() => {});
    return;
  }

  const product = products[selection - 1];
  if (product.ownerId !== userId) {
    await message.reply('❌ You can only remove your own products.');
    await message.delete().catch(() => {});
    return;
  }

  await Product.deleteOne({ _id: product._id });
  await message.reply(`✅ "${product.productName}" removed.`);
  await message.delete().catch(() => {});
}

module.exports = {
  handleAitTrainCommand,
  handleProductInfoInput,
  handleRemoveCommand,
  handleRemoveSelection,
  usersWaitingForProductInfo,
  usersWaitingForRemove
};
