import TelegramBot from 'node-telegram-bot-api';
import * as process from 'process';
import express from 'express';
import bodyParser from 'body-parser';

const token = process.env.TELEGRAM_BOT_TOKEN!;
const url = process.env.WEBHOOK_URL!; // URL of webhook server
const port = Number(process.env.PORT) || 3000;

// Init bot with webhook instead of polling
export const bot = new TelegramBot(token, { webHook: { port } });

// Init express app to handle webhook
const app = express();
app.use(bodyParser.json());

// Set webhook URL
bot.setWebHook(`${url}/webhook/${token}`);

// Route handle webhook
app.post(`/webhook/${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (_, res) => {
    res.status(200).json({ status: 'OK' });
});

// Start server
app.listen(port, () => {
    console.log(`Webhook server is running on port ${port}`);
});
