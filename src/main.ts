import dotenv from 'dotenv';
dotenv.config();

import { bot } from './bot';
import { walletMenuCallbacks } from './connect-wallet-menu';
import {
    handleConnectCommand,
    handleDisconnectCommand,
    handleSendTXCommand,
    handleShowMyWalletCommand,
    handleSendNFTsCommand,
    handleListNFTsCommand,
    handleAutoSendNFTsCommand
} from './commands-handlers';
import { initRedisClient } from './ton-connect/storage';
import TelegramBot from 'node-telegram-bot-api';

async function main(): Promise<void> {
    await initRedisClient();

    const callbacks: Record<string, (query: TelegramBot.CallbackQuery, data: any) => Promise<void>> = {
        connect: (query, _) => handleConnectCommand(query.message!),
        send_tx: (query, _) => handleSendTXCommand(query.message!),
        disconnect: (query, _) => handleDisconnectCommand(query.message!),
        my_wallet: (query, _) => handleShowMyWalletCommand(query.message!),
        send_nfts: (query, _) => handleSendNFTsCommand(query.message!),
        list_nfts: (query, _) => handleListNFTsCommand(query.message!),
        auto_send_nfts: (query, _) => handleAutoSendNFTsCommand(query.message!),
        ...walletMenuCallbacks
    };

    // Xử lý callback_query khi nút được bấm
    bot.on('callback_query', async (query) => {
        if (!query.data) return;

        try {
            const { method, data } = JSON.parse(query.data) as { method: string; data: any };
            
            const handler = callbacks[method];
            if (handler) {
                await handler(query, data);
                await bot.answerCallbackQuery(query.id);
            }
        } catch (error) {
            console.error('Error handling callback:', error);
            await bot.answerCallbackQuery(query.id, { text: 'Có lỗi xảy ra!' });
        }
    });

    bot.onText(/\/connect/, handleConnectCommand);

    bot.onText(/\/send_tx/, handleSendTXCommand);

    bot.onText(/\/disconnect/, handleDisconnectCommand);

    bot.onText(/\/my_wallet/, handleShowMyWalletCommand);

    bot.onText(/\/send_nfts/, handleSendNFTsCommand);

    bot.onText(/\/list_nfts/, handleListNFTsCommand);

    bot.onText(/\/auto_send_nfts/, handleAutoSendNFTsCommand);

    bot.onText(/\/start/, (msg: TelegramBot.Message) => {
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '👛 Connect', callback_data: JSON.stringify({ method: 'connect', data: '' }) },
                        { text: '❌ Disconnect', callback_data: JSON.stringify({ method: 'disconnect', data: '' }) }
                    ],
                    [
                        { text: '👛 My Wallet', callback_data: JSON.stringify({ method: 'my_wallet', data: '' }) },
                        { text: '📤 Send NFTs', callback_data: JSON.stringify({ method: 'send_nfts', data: '' }) }
                    ],
                    [
                        { text: '📋 List NFTs', callback_data: JSON.stringify({ method: 'list_nfts', data: '' }) },
                        { text: '🔄 Auto Send NFTs', callback_data: JSON.stringify({ method: 'auto_send_nfts', data: '' }) }
                    ]
                ]
            }
        };

        bot.sendMessage(
            msg.chat.id,
            'TON MultiSendNFTs Bot - #1 Ton Utility Bot',
            options
        );
    });
}

main();
