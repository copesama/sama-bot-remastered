const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const { Product } = require('../utils/mongooseUtil');
const { getPrefix } = require('./prefixCommand');

// Maps to track waiting states
const usersWaitingForAITrainInput = new Map();
const usersWaitingForRemoveInput = new Map();

// New Map to track monitoring intervals by product ID
const monitoringIntervals = new Map();

// List of AI providers
const AI_PROVIDERS = [
  'x-ai/grok-4-fast:free',
  'tngtech/deepseek-r1t2-chimera:free',
  'z-ai/glm-4.5-air:free',
  'qwen/qwen3-235b-a22b:free',
  'moonshotai/kimi-k2:free',
  'google/gemini-2.0-flash-exp:free',
  'microsoft/mai-ds-r1:free',
  'mistralai/mistral-small-3.2-24b-instruct:free',
  'meta-llama/llama-4-maverick:free',
  'qwen/qwen3-14b:free',
  'mistralai/mistral-nemo:free',
  'openai/gpt-oss-20b:free',
  'deepseek/deepseek-r1-0528:free',
  'deepseek/deepseek-chat-v3.1:free',
  'deepseek/deepseek-r1:free',
  'tencent/hunyuan-a13b-instruct:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'google/gemma-3n-e2b-it:free',
  'google/gemma-3n-e4b-it:free',
  'meta-llama/llama-3.3-8b-instruct:free'
];

/**
 * Starts monitoring for a product: queries AI providers every 5 hours and DMs responses
 * @param {string} productId - Product ID
 * @param {string} userId - User ID for DM
 * @param {string} structuredContent - Product content as prompt
 * @param {Object} client - Discord client for DM
 */
async function startMonitoring(productId, userId, structuredContent, client) {
  const intervalId = setInterval(async () => {
    const responses = [];
    const prompt = `${structuredContent}\n\nDo you find this product good? Explain why.`;

    for (const model of AI_PROVIDERS) {
      try {
        const response = await axios.post(
          'https://openrouter.ai/api/v1/chat/completions',
          {
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7
          },
          {
            headers: {
              'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
              'Content-Type': 'application/json',
            }
          }
        );
        responses.push(`**${model}**: ${response.data.choices[0].message.content.trim()}`);
      } catch (error) {
        console.error(`Error querying ${model}:`, error.message);
        responses.push(`**${model}**: Error - ${error.message}`);
      }
      // 1-minute delay between requests
      await new Promise(resolve => setTimeout(resolve, 60000));
    }

    // Send DM to user
    try {
      const user = await client.users.fetch(userId);
      const dmContent = `AI Feedback for your product:\n\n${responses.join('\n\n')}`;
      // Split if too long (Discord limit ~2000 chars)
      const chunks = [];
      for (let i = 0; i < dmContent.length; i += 1900) {
        chunks.push(dmContent.substring(i, i + 1900));
      }
      for (const chunk of chunks) {
        await user.send(chunk);
      }
    } catch (error) {
      console.error(`Failed to DM user ${userId}:`, error.message);
    }
  }, 5 * 60 * 60 * 1000); // 5 hours

  monitoringIntervals.set(productId, intervalId);
}

/**
 * Generates structured marketing content from user input
 * @param {string} productName - The product name
 * @param {string} userInput - The user's product information
 * @returns {Promise<string>} - The structured content
 */
async function generateStructuredContent(productName, userInput) {
  try {
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model: 'x-ai/grok-4-fast:free',
        messages: [
          {
            role: 'system',
            content: 'You are an expert marketer specializing in creating professional, structured sales materials. Transform raw product information into engaging, persuasive content with sections like Overview, Unique Features, Strengths, Weaknesses, Comparisons, and Sales Pitch. Use professional language, bullet points, and marketing flair while preserving the original intent. Respond in the same language as the user input.'
          },
          {
            role: 'user',
            content: `Product: "${productName}"

User-provided info (what it offers, unique aspects, strengths, weaknesses, comparisons to similar products, sales points):\n\n${userInput}

Refactor this into structured, professional marketing content. Include:
- Overview: Brief description of what the product offers
- Unique Features: What sets it apart
- Strengths: Key advantages
- Weaknesses: Honest limitations (framed positively if possible)
- Comparisons: How it stacks up against competitors
- Sales Pitch: Compelling points for promotion

Keep it concise yet comprehensive, under 2000 words. Use bullet points and headings for structure. Match the user's language.`
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
    throw new Error('Failed to generate marketing content. Please try again later.');
  }
}

/**
 * Handles the initial !aitrain command
 * @param {Object} message - The Discord message object
 * @param {string} productName - The product name
 * @returns {Promise<Object|null>} - Waiting data or null on error
 */
async function handleAITrainCommand(message, productName) {
  try {
    const prefix = await getPrefix(message.guild?.id);
    
    if (!productName) {
      await message.reply(`Please provide a product name. Example: \`${prefix}aitrain MyAwesomeApp\``);
      return null;
    }

    // Check if product name already exists
    const existingProduct = await Product.findOne({ productName });
    if (existingProduct) {
      await message.reply(`A product named "${productName}" already exists. Use \`${prefix}aitrain remove\` to manage it.`);
      return null;
    }

    // Check total count
    const totalProducts = await Product.countDocuments();
    if (totalProducts >= 5) {
      await message.reply('Maximum of 5 products reached. Use \`${prefix}aitrain remove\` to free up space.');
      return null;
    }

    const loadingMessage = await message.reply(`Setting up AI training for "${productName}"...`);

    const infoEmbed = new EmbedBuilder()
      .setColor('#9b59b6')
      .setTitle(`Product Info for ${productName}`)
      .setDescription('Please reply with detailed info about your product. Include:\n• What it offers\n• Unique aspects\n• Strengths\n• Weaknesses\n• Comparisons to similar products\n• Any sales promotion points\n\nAim for 200+ words for best results.')
      .setFooter({ text: 'Respond in your next message' });

    await loadingMessage.edit({
      content: `${message.author}, provide info for "${productName}":`,
      embeds: [infoEmbed]
    });

    usersWaitingForAITrainInput.set(message.author.id, { productName, loadingMessage, prefix });
    return { productName, loadingMessage, prefix };
  } catch (error) {
    console.error('Error in handleAITrainCommand:', error);
    if (message) {
      await message.reply('Error setting up AI training. Please try again.');
    }
    return null;
  }
}

/**
 * Handles user input for product info and generates/stores content
 * @param {string} userId - User ID
 * @param {string} userInput - The input text
 * @param {Object} message - Message object
 * @param {Object} client - Discord client
 * @returns {Promise<boolean>} - Success flag
 */
async function handleAITrainInput(userId, userInput, message, client) {
  const data = usersWaitingForAITrainInput.get(userId);
  if (!data) {
    const prefix = await getPrefix(message.guild?.id);
    await message.reply(`No active training session. Start with \`${prefix}aitrain <product>\``);
    return false;
  }

  const { productName, loadingMessage, prefix } = data;

  if (userInput.trim().length < 100) {
    if (loadingMessage?.edit) {
      await loadingMessage.edit(`Response too short (<100 chars). Please provide more details and try again.`);
    } else {
      await message.reply(`Response too short (<100 chars). Please provide more details and try again.`);
    }
    return false;
  }

  if (loadingMessage?.edit) {
    await loadingMessage.edit(`Processing your info for "${productName}"... This may take a moment.`);
  }

  try {
    const structuredContent = await generateStructuredContent(productName, userInput);

    // Double-check limits before saving
    const totalProducts = await Product.countDocuments();
    if (totalProducts >= 5) {
      if (loadingMessage?.edit) {
        await loadingMessage.edit(`Maximum products reached during processing. Try removing one first.`);
      } else {
        await message.reply(`Maximum products reached during processing. Try removing one first.`);
      }
      return false;
    }

    const newProduct = new Product({
      productName,
      structuredContent,
      ownerId: message.author.id
    });
    await newProduct.save();

    // Start monitoring after saving
    startMonitoring(newProduct._id.toString(), message.author.id, structuredContent, client);

    const successEmbed = new EmbedBuilder()
      .setColor('#27ae60')
      .setTitle(`✅ ${productName} Trained Successfully!`)
      .setDescription('Your product info has been refactored into professional marketing content and stored.')
      .addFields({ name: 'Total Products', value: `${totalProducts + 1}/5` });

    await message.channel.send({
      content: `${message.author}, here's your structured marketing content for "${productName}":`,
      embeds: [successEmbed]
    });

    // Send content (split if long)
    const MAX_LEN = 1900;
    const chunks = [];
    for (let i = 0; i < structuredContent.length; i += MAX_LEN) {
      chunks.push(structuredContent.substring(i, i + MAX_LEN));
    }
    for (let i = 0; i < chunks.length; i++) {
      await message.channel.send(`**Part ${i + 1}/${chunks.length}**:\n\n${chunks[i]}`);
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 1000));
    }

    if (loadingMessage?.edit) {
      await loadingMessage.edit(`✅ "${productName}" is now available. Use \`${prefix}aitrain remove\` to manage products.`);
    }

    usersWaitingForAITrainInput.delete(userId);
    return true;
  } catch (error) {
    console.error('Error in handleAITrainInput:', error);
    if (loadingMessage?.edit) {
      await loadingMessage.edit(`Error processing "${productName}". Please try again.`);
    } else {
      await message.reply(`Error processing "${productName}". Please try again.`);
    }
    usersWaitingForAITrainInput.delete(userId);
    return false;
  }
}

/**
 * Handles !aitrain remove command
 * @param {Object} message - Message object
 * @returns {Promise<void>}
 */
async function handleRemoveCommand(message) {
  try {
    const prefix = await getPrefix(message.guild?.id);
    const products = await Product.find({}).sort({ createdAt: -1 });

    if (products.length === 0) {
      await message.reply('No products stored yet.');
      return;
    }

    let list = 'Available products:\n';
    products.forEach((p, i) => {
      const owner = `<@${p.ownerId}>`;
      list += `${i + 1}. **${p.productName}** (Owner: ${owner})\n`;
    });

    const removeEmbed = new EmbedBuilder()
      .setColor('#e74c3c')
      .setTitle('Remove Product')
      .setDescription(`${list}\n\nReply with the number (1-${products.length}) or exact product name to remove. You can only remove your own products.`);

    await message.reply({
      content: `${message.author}, which product do you want to remove?`,
      embeds: [removeEmbed]
    });

    usersWaitingForRemoveInput.set(message.author.id, { products, prefix });
  } catch (error) {
    console.error('Error in handleRemoveCommand:', error);
    await message.reply('Error listing products.');
  }
}

/**
 * Handles user choice for removal
 * @param {string} userId - User ID
 * @param {string} choice - User input (number or name)
 * @param {Object} message - Message object
 * @returns {Promise<boolean>} - Success flag
 */
async function handleRemoveInput(userId, choice, message) {
  const data = usersWaitingForRemoveInput.get(userId);
  if (!data) {
    const prefix = await getPrefix(message.guild?.id);
    await message.reply(`No remove session active. Use \`${prefix}aitrain remove\``);
    return false;
  }

  const { products, prefix } = data;
  let productToRemove = null;

  // Try parsing as number
  const numChoice = parseInt(choice.trim(), 10);
  if (numChoice >= 1 && numChoice <= products.length) {
    productToRemove = products[numChoice - 1];
  } else {
    // Try exact name match
    productToRemove = products.find(p => p.productName.toLowerCase() === choice.trim().toLowerCase());
  }

  if (!productToRemove) {
    await message.reply('Invalid choice. Please try again with a number or exact name.');
    return false;
  }

  if (productToRemove.ownerId !== userId) {
    await message.reply('You can only remove your own products.');
    usersWaitingForRemoveInput.delete(userId);
    return false;
  }

  try {
    // Clear monitoring interval before deleting
    const intervalId = monitoringIntervals.get(productToRemove._id.toString());
    if (intervalId) {
      clearInterval(intervalId);
      monitoringIntervals.delete(productToRemove._id.toString());
    }

    await Product.deleteOne({ _id: productToRemove._id });
    await message.reply(`✅ "${productToRemove.productName}" removed successfully. Total now: ${products.length - 1}/5`);
    usersWaitingForRemoveInput.delete(userId);
    return true;
  } catch (error) {
    console.error('Error in handleRemoveInput:', error);
    await message.reply('Error removing product.');
    return false;
  }
}

module.exports = {
  handleAITrainCommand,
  handleAITrainInput,
  handleRemoveCommand,
  handleRemoveInput,
  usersWaitingForAITrainInput,
  usersWaitingForRemoveInput
};