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

    const callbacks = {
        ...walletMenuCallbacks
    };

    bot.on('callback_query', query => {
        if (!query.data) {
            return;
        }

        let request: { method: string; data: string };

        try {
            request = JSON.parse(query.data);
        } catch {
            return;
        }

        if (!callbacks[request.method as keyof typeof callbacks]) {
            return;
        }

        callbacks[request.method as keyof typeof callbacks](query, request.data);
    });

    bot.onText(/\/connect/, handleConnectCommand);

    bot.onText(/\/send_tx/, handleSendTXCommand);

    bot.onText(/\/disconnect/, handleDisconnectCommand);

    bot.onText(/\/my_wallet/, handleShowMyWalletCommand);

    bot.onText(/\/send_nfts/, handleSendNFTsCommand);

    bot.onText(/\/list_nfts/, handleListNFTsCommand);

    bot.onText(/\/auto_send_nfts/, handleAutoSendNFTsCommand);

    bot.onText(/\/start/, (msg: TelegramBot.Message) => {
        bot.sendMessage(
            msg.chat.id,
            `
Ton MultiSend NFTs Bot
            
Commands list: 
/connect - Connect to a wallet
/my_wallet - Show connected wallet
/send_tx - Send transaction
/disconnect - Disconnect from the wallet
/list_nfts - List NFTs
/send_nfts - Send NFTs
/auto_send_nfts - Auto send NFTs
`
        );
    });
}

main();
