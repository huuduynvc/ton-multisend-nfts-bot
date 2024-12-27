import { Address, beginCell, toNano } from '@ton/core';
import { bot } from './bot';
import { getConnector } from './ton-connect/connector';
import TelegramBot from 'node-telegram-bot-api';
import { isTelegramUrl } from '@tonconnect/sdk';
import axios from 'axios';

interface NFTTransfer {
    toAddress: string;
    nftAddress: string; 
    nftId: string;
    amount: number;
}

const userInputState = new Map<number, {
    step: 'waiting_addresses' | 'waiting_collection' | 'waiting_nft_ids' | 'waiting_amounts',
    data: Partial<NFTTransfer>
}>();

export async function handleSendNFTsCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const connector = getConnector(chatId);
    await connector.restoreConnection();
    
    if (!connector.connected) {
        await bot.sendMessage(chatId, 'Please connect your wallet before sending NFT. Use the /connect command');
        return;
    }

    userInputState.set(chatId, {
        step: 'waiting_collection',
        data: {}
    });

    await bot.sendMessage(
        chatId,
        'Please enter the NFT collection address first'
    );

    bot.once('message', async (msg) => {
        await handleCollectionInput(msg);
    });
}

async function handleCollectionInput(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const collectionAddress = msg.text?.trim();

    // Validate collection address
    try {
        if (!collectionAddress || !Address.parse(collectionAddress)) {
            throw new Error('Invalid collection address');
        }
    } catch (e) {
        await bot.sendMessage(chatId, (e as Error).message);
        return;
    }

    const state = userInputState.get(chatId);
    if (state) {
        state.data.nftAddress = collectionAddress;
        state.step = 'waiting_addresses';
        
        await bot.sendMessage(
            chatId,
            'Please enter the list in the following format (one transaction per line):\n' +
            '<recipient address> <NFT ID> <payload (optional, no space)>\n\n' +
            'Example:\n' +
            'EQA0i8-CdGnF_DhUHHf92R1ONH6sIA9vLZ_WLcCIhfBBXwtG 1 ton_hello_world\n' +
            'EQA0i8-CdGnF_DhUHHf92R1ONH6sIA9vLZ_WLcCIhfBBXwtG 2 ton_hello_world'
        );

        bot.once('message', async (msg) => {
            await handleAddressesInput(msg, collectionAddress);
        });
    }
}

async function handleAddressesInput(msg: TelegramBot.Message, collectionAddress: string): Promise<void> {
    const chatId = msg.chat.id;
    const lines = msg.text?.split('\n') || [];
    const connector = getConnector(chatId);
    
    try {
        // Validate format of each line first
        lines.forEach(line => {
            const [address, nftId, payload] = line.trim().split(' ');
            if (!address || !nftId) {
                throw new Error('Invalid format. Please enter in the format: <recipient address> <NFT ID> <payload (optional, no space)>');
            }
            if (!Address.parse(address)) {
                throw new Error(`Invalid address: ${address}`);
            }
        });

        // Determine wallet version and message limit
        const walletInfo = await getWalletInfo(connector.wallet?.account.address.toString() || '')
        console.log(walletInfo)
        const isV5Wallet = walletInfo?.wallet_type.includes('v5');
        const MSG_LIMIT = isV5Wallet ? 255 : 4;

        // Process transactions in batches
        const fee = toNano('0.1');
        const messages = []
        
        for (let i = 0; i < lines.length; i++) {
            const [recipient, nftId, payload] = lines[i]!.trim().split(' ')
            const finalPayload = payload ? payload : `Ton MultiSendNFt Bot: ${process.env.TELEGRAM_BOT_LINK}`
            const nftItemAddress = await getNftItemAddress(collectionAddress, nftId!)
            messages.push({
                address: nftItemAddress,
                amount: fee.toString(),
                payload: beginCell()
                .storeUint(0x5fcc3d14, 32)               // NFT transfer op code
                .storeUint(1, 64)                        // query_id
                .storeAddress(Address.parse(recipient!))     // new_owner
                .storeAddress(Address.parse(process.env.ADMIN_ADDRESS!)) // response_destination for excess
                .storeUint(0, 1)                         // custom_payload
                .storeCoins(toNano('0.000000001'))       // forward_amount
                .storeUint(1, 1)                         // forward_payload
                .storeRef(
                  beginCell()
                    .storeUint(0, 32)
                    .storeStringTail(finalPayload!)
                    .endCell()
                )
                .endCell()
                    .toBoc()
                    .toString('base64')
            });
        }

        for (let i = 0; i < messages.length; i += MSG_LIMIT) {
            const batch = messages.slice(i, i + MSG_LIMIT);
            await connector.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 360, // Hết hạn sau 5 phút
                messages: batch
            });
            
            await bot.sendMessage(
                chatId,
                `Sending batch ${Math.floor(i/MSG_LIMIT) + 1}/${Math.ceil(messages.length/MSG_LIMIT)}`
            );

            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        userInputState.delete(chatId);

    } catch (e) {
        await bot.sendMessage(chatId, (e as Error).message);
        return;
    }
}

async function getNFTsFromCollection(collectionAddress: string, userAddress: string) {
    try {
        const response = await axios.get(`${process.env.TONCENTER_API_URL}/nft/items`, {
            params: {
                owner_address: userAddress,
                collection_address: collectionAddress,
                limit: 100,
                offset: 0
            },
            headers: {
                'X-API-Key': process.env.TONCENTER_API_KEY
            }
        })

        return response.data.nft_items
    } catch (error) {
        console.log("Fetch nft item address error", error)
        return []
    }
}

async function getNftItemAddress(nftCollectionAddress: string, nftId: string): Promise<string> {
    try {
        const response = await axios.get(`${process.env.TONCENTER_API_URL}/nft/items`, {
            params: {
                index: nftId,
                collection_address: nftCollectionAddress,
                limit: 1,
                offset: 0
            },
            headers: {
                'X-API-Key': process.env.TONCENTER_API_KEY
            }
        })

        return response.data.nft_items[0].address
    } catch (error) {
        console.log("Fetch nft item address error", error)
        return ""
    }
}

async function getWalletInfo(walletAddress: string) {
    try {
        const response = await axios.get(`${process.env.TONCENTER_API_URL}/walletInformation`, {
            params: {
                address: walletAddress,
                use_v2: true
            },
            headers: {
                'X-API-Key': process.env.TONCENTER_API_KEY
            }
        })

        return response.data
    } catch (error) {
        console.log("Fetch wallet info error", error)
        return {}
    }
}

export async function handleListNFTsCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const connector = getConnector(chatId);
    await connector.restoreConnection();
    
    if (!connector.connected) {
        await bot.sendMessage(chatId, 'Please connect your wallet before sending NFT. Use the /connect command');
        return;
    }

    userInputState.set(chatId, {
        step: 'waiting_collection',
        data: {}
    });

    await bot.sendMessage(
        chatId,
        'Please enter the NFT collection address'
    );

    bot.once('message', async (msg) => {
        await handleListCollectionInput(msg);
    });
}

async function handleListCollectionInput(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const collectionAddress = msg.text?.trim();
    const connector = getConnector(chatId);

    try {
        if (!collectionAddress || !Address.parse(collectionAddress)) {
            throw new Error('Invalid collection address');
        }

        const nfts = await getNFTsFromCollection(
            collectionAddress,
            connector.wallet!.account.address.toString()
        );

        if (nfts.length === 0) {
            await bot.sendMessage(chatId, 'No NFT found in this collection');
            return;
        }

        const chunkSize = 20;
        for (let i = 0; i < nfts.length; i += chunkSize) {
            const chunk = nfts.slice(i, i + chunkSize);
            let message = `NFTs in collection (${i + 1}-${Math.min(i + chunkSize, nfts.length)} of ${nfts.length}):\n\n`;
            
            chunk.forEach((nft: any) => {
                message += `NFT ID: ${nft.index}\n`;
                message += `NFT Address: ${Address.parse(nft.address).toString({
                    bounceable: false,
                    urlSafe: true,
                    testOnly: false
                })}\n\n`;
            });

            await bot.sendMessage(chatId, message);
            
            if (i + chunkSize < nfts.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

    } catch (e) {
        await bot.sendMessage(chatId, (e as Error).message);
    }
}

export async function handleAutoSendNFTsCommand(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const connector = getConnector(chatId);
    await connector.restoreConnection();
    
    if (!connector.connected) {
        await bot.sendMessage(chatId, 'Please connect your wallet before sending NFT. Use the /connect command');
        return;
    }

    userInputState.set(chatId, {
        step: 'waiting_collection',
        data: {}
    });

    await bot.sendMessage(
        chatId,
        'Please enter the NFT collection address first'
    );

    bot.once('message', async (msg) => {
        await handleAutoSendCollectionInput(msg);
    });
}

async function handleAutoSendCollectionInput(msg: TelegramBot.Message): Promise<void> {
    const chatId = msg.chat.id;
    const collectionAddress = msg.text?.trim();

    // Validate collection address
    try {
        if (!collectionAddress || !Address.parse(collectionAddress)) {
            throw new Error('Invalid collection address');
        }
    } catch (e) {
        await bot.sendMessage(chatId, (e as Error).message);
        return;
    }

    const state = userInputState.get(chatId);
    if (state) {
        state.data.nftAddress = collectionAddress;
        state.step = 'waiting_addresses';
        
        await bot.sendMessage(
            chatId,
            'Please enter the list in the following format (one transaction per line):\n' +
            '<recipient address> <payload (optional, no space)>\n\n' +
            'Example:\n' +
            'EQA0i8-CdGnF_DhUHHf92R1ONH6sIA9vLZ_WLcCIhfBBXwtG ton_hello_world\n' +
            'EQA0i8-CdGnF_DhUHHf92R1ONH6sIA9vLZ_WLcCIhfBBXwtG ton_hello_world'
        );

        bot.once('message', async (msg) => {
            await handleAutoSendAddressesInput(msg, collectionAddress);
        });
    }
}

async function handleAutoSendAddressesInput(msg: TelegramBot.Message, collectionAddress: string): Promise<void> {
    const chatId = msg.chat.id;
    const lines = msg.text?.split('\n') || [];
    const connector = getConnector(chatId);
    
    try {
        // Validate format of each line first
        lines.forEach(line => {
            const [address, payload] = line.trim().split(' ');
            if (!address) {
                throw new Error('Invalid address. Please enter in the format: <recipient address>');
            }
        });

        // Determine wallet version and message limit
        const walletInfo = await getWalletInfo(connector.wallet?.account.address.toString() || '')
        console.log(walletInfo)
        const isV5Wallet = walletInfo?.wallet_type.includes('v5');
        const MSG_LIMIT = isV5Wallet ? 255 : 4;

        // Process transactions in batches
        const fee = toNano('0.1');
        const messages = []
        const nfts = await getNFTsFromCollection(collectionAddress, connector.wallet!.account.address.toString())

        if(nfts.length === 0 || nfts.length < lines.length) {
            await bot.sendMessage(chatId, 'Not enough NFTs in this collection');
            return;
        }

        for (let i = 0; i < lines.length; i++) {
            const [recipient, payload] = lines[i]!.trim().split(' ')
            const finalPayload = payload ? payload : `Ton MultiSendNFt Bot: ${process.env.TELEGRAM_BOT_LINK}`
            messages.push({
                address: nfts[i].address,
                amount: fee.toString(),
                payload: beginCell()
                .storeUint(0x5fcc3d14, 32)               // NFT transfer op code
                .storeUint(1, 64)                        // query_id
                .storeAddress(Address.parse(recipient!))     // new_owner
                .storeAddress(Address.parse(process.env.ADMIN_ADDRESS!)) // response_destination for excess
                .storeUint(0, 1)                         // custom_payload
                .storeCoins(toNano('0.000000001'))       // forward_amount
                .storeUint(1, 1)                         // forward_payload
                .storeRef(
                  beginCell()
                    .storeUint(0, 32)
                    .storeStringTail(finalPayload!)
                    .endCell()
                )
                .endCell()
                    .toBoc()
                    .toString('base64')
            });
        }

        for (let i = 0; i < messages.length; i += MSG_LIMIT) {
            const batch = messages.slice(i, i + MSG_LIMIT);
            await connector.sendTransaction({
                validUntil: Math.floor(Date.now() / 1000) + 360, // Hết hạn sau 5 phút
                messages: batch
            });
            
            await bot.sendMessage(
                chatId,
                `Sending batch ${Math.floor(i/MSG_LIMIT) + 1}/${Math.ceil(messages.length/MSG_LIMIT)}`
            );

            await new Promise(resolve => setTimeout(resolve, 10000));
        }

        userInputState.delete(chatId);

    } catch (e) {
        await bot.sendMessage(chatId, (e as Error).message);
        return;
    }
}
