import TelegramBot from 'node-telegram-bot-api';
import * as process from 'process';

const token = process.env.TELEGRAM_BOT_TOKEN!;

export const bot = new TelegramBot(token, { polling: true });

bot.on('polling_error', (error) => {
    console.log('Polling error:', error.message);
    
    if (error.message.includes('terminated by other getUpdates request')) {
        console.log('Trying to reconnect after 10 seconds...');
        setTimeout(() => {
            bot.stopPolling()
                .then(() => {
                    return bot.startPolling();
                })
                .catch(console.error);
        }, 10000);
    }
});
