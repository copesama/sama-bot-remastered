# Sama Bot Remastered

Discord bot that generates everything from user prompts! From fully functional web games and images to stories, quizzes, and music.

## Features

- **Game Generation**: Generates playable games based on user prompts, including choice-based games and multiplayer experiences.
- **Media Generation**: Create images and music directly within Discord.
- **Story & Quiz Generation**: Interactive storytelling and dynamically generated quizzes.
- **Finance News**: Get the latest financial news.
- **Voice Support**: Full voice state support (via `@discordjs/voice`).
- **Web Interface / Express Server**: Built-in web server for hosting generated mini-games locally or via your domain.

## Prerequisites

- [Node.js](https://nodejs.org/) v16.x or higher
- A [Discord Bot Token](https://discord.com/developers/applications)
- A [MongoDB](https://www.mongodb.com/) database
- API Keys for various services:
  - OpenRouter (for AI interactions)
  - Segmind & HuggingFace (for media generation)
  - AlphaVantage & NewsAPI (for finance news)

## Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/sama-bot-remastered.git
   cd sama-bot-remastered
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Copy the example environment file and fill in your details:
   ```bash
   cp .env.example .env
   ```
   *Make sure to add your Discord Bot Token, JWT Secret, SERVER_URL, and required API keys (OpenRouter, Segmind, HuggingFace, AlphaVantage, NewsAPI) in the `.env` file.*

## Usage

Start the bot in production mode:
```bash
npm start
```

Or start the bot in development mode (with auto-reloading):
```bash
npm run dev
```

## Commands

- `!help`: Lists all available commands
- Commands are configured dynamically based on user prompts to generate images, text, games, quizzes, and more!
