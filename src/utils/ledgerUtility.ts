import { MongoClient, ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { SolanaTrackerClient , SolanaTrackerSwapClient} from './solanaTracker';
import { SolanaTransferService, getSolBalance } from './solanaUtils';
import { Keypair, Connection } from '@solana/web3.js';
import { SecureEnvManager } from './credentialManager';
import { callRpcServer } from '../Rpc/Rpc_consumer';
import bs58 from 'bs58';
import {config} from 'dotenv';

config();

interface TokenSellParams{
    takeProfitPriceChange: number,
    stopLossPriceChange: number,
}

interface ITransactionDetails {
    trx: ITransaction,
    totalValueSOL: number,
    tokenAmount: number,
    pricePerToken: number
}

interface IOverallPnL {
    totalPnL: number,
    realizedPnL: number,
    unrealizedPnL: number,
    totalSOLSpent: number,
    totalSOLReceived: number,
    netSOLFlow: number
}

interface ITokenPnL {
    realizedPnL: number,
    unrealizedPnL: number,
    totalPnL: number,
    totalTokensBought: number,
    totalTokensSold: number,
    currentHoldings: number,
    averageBuyPrice: number,
    investedAmount: number,
    receivedAmount: number,
    investedInCurrentHoldings: number
}

interface ITransactionStats {
    totalTrades: number,
    totalBuyTrades: number,
    totalSellTrades: number,
    totalSOLTraded: number,
    totalSOLSpent: number,
    totalSOLReceived: number,
    uniqueTokensTraded: number,
    averageTradeSize: number,
    totalFeesPaid: number,
    firstTradeDate: Date | null,
    lastTradeDate: Date | null,
    tradingPeriodDays: number,
    winRate: number,
    pnlStats: IOverallPnL
}

interface ITransaction {
    id: string,
    agentId: string, 
    mint: string, 
    action: string,  
    amountIn    : number, 
    amountOut: number, 
    executionPrice: number, 
    status: string,
    transactionHash?: string,
    timestamp?: number,
    fees?: number,
    notes?: string
}

export class SolanaLedgerUtility {
    //create ledger
    private db: any;
    LedgerCollection: any;
    TokenCollection: any;
    private solanaTracker: SolanaTrackerClient;
    credentialManager: SecureEnvManager;
    constructor() {
        this.db = new MongoClient(process.env.SOLANA_MONGO_URL!);
        this.LedgerCollection = this.db.db('solana').collection('ledger');
        this.TokenCollection = this.db.db('solana').collection('txns');
        this.solanaTracker = new SolanaTrackerClient(process.env.SOLANA_TRACKER_API_KEY! as string);
        this.credentialManager = SecureEnvManager.getInstance();
    }

    /**
     * Update the ledger
     * @param agentId - The agent/user id
     * @param mint - The token address
     * @param action - The action: buy / sell / close
     * @param token - The token : {mint: string, symbol: string, name: string}
     * @param amount - The amount
     * @param price - The price of the token in (sol)
     * @param status - The status: open / watching / sold
     */
    
    /**
     * Add a transaction to the ledger
     * @param agentId - The agent id
     * @param mint - The token address
     * @param action - The action: buy / sell / close
     * @param token - The token : {mint: string, symbol: string, name: string}
     * @param amount - The amount of tokens
     * @param price - The price of the token in SOL
     * @param status - The status: open / watching / sold
     * @param transactionHash - The transaction hash
     * @param timestamp - The timestamp of the transaction
     * @param totalValue - The total value of the transaction in SOL (amount * price)
     * @param fees - The transaction fees in SOL
     * @param priceUsd - The price of the token in USD at transaction time
     * @param solPriceUsd - The price of SOL in USD at transaction time
     * @param notes - Additional notes about the transaction
     */
    async addTransaction({
        agentId, 
        mint, 
        action, 
        amountIn, 
        amountOut, 
        executionPrice, 
        status, 
        transactionHash, 
        timestamp = Date.now(), 
        fees
    }: ITransaction) {
        try {
            // Calculate total value if not provided
            
            
            const transaction = {
                agentId,
                mint,
                action,
                amountIn,
                amountOut,
                executionPrice,
                status,
                transactionHash,
                timestamp,
                fees,
                createdAt: new Date()
            };
            
            const saved = await this.TokenCollection.insertOne(transaction);
            return saved;
        } catch(e) {
            console.log(e);
            throw e;
        }
    }

    async getTxnByAgentId({agentId}:{agentId: string}) : Promise<ITransaction[]> {
        try{
            const txns = await this.TokenCollection.find({agentId: agentId}).toArray();
            const tnxData: ITransaction[] = txns.map((txn: any) => ({
                id: txn._id.toString(),
                agentId: txn.agentId,
                mint: txn.mint,
                action: txn.action,
                amountIn: txn.amountIn,
                amountOut: txn.amountOut,
                executionPrice: txn.executionPrice,
                status: txn.status,
                transactionHash: txn.transactionHash,
                timestamp: txn.timestamp,
                fees: txn.fees,
                createdAt: txn.createdAt
            }));
            return tnxData;
        }catch(e){
            console.log(e)
            return [] as ITransaction[]
        }
    }

    async getMintTxn({mint}:{mint: string}): Promise<ITransaction[]> {
        try{
            const txns = await this.TokenCollection.find({mint: mint}).toArray();
            const tnxData: ITransaction[] = txns.map((txn: any) => ({
                id: txn._id.toString(),
                agentId: txn.agentId,
                mint: txn.mint,
                action: txn.action,
                amountIn: txn.amountIn,
                amountOut: txn.amountOut,
                executionPrice: txn.executionPrice,
                status: txn.status,
                transactionHash: txn.transactionHash,
                timestamp: txn.timestamp,
                fees: txn.fees,
                createdAt: txn.createdAt
            }));
            return tnxData;
        }catch(e){
            console.log(e)
            return [] as ITransaction[]
        }
    }

    async getTxnByAgentIdAndMint({agentId, mint}:{agentId: string, mint: string}) : Promise<ITransaction[]> {
        try{
            const txns = await this.TokenCollection.find({agentId: agentId, mint: mint}).toArray();
            const tnxData: ITransaction[] = txns.map((txn: any) => ({
                id: txn._id.toString(),
                agentId: txn.agentId,
                mint: txn.mint,
                action: txn.action,
                amountIn: txn.amountIn,
                amountOut: txn.amountOut,
                executionPrice: txn.executionPrice,
                status: txn.status,
                transactionHash: txn.transactionHash,
                timestamp: txn.timestamp,
                fees: txn.fees,
                createdAt: txn.createdAt
            }));
            return tnxData;
        }catch(e: any){
            console.log(e)
            return [] as ITransaction[]
        }
    }

    /**
     * Get detailed transaction history for a user
     * @param agentId - The agent id
     * @returns Array of transactions with additional computed fields
     */
    async getUserTransactionDetails({agentId}: {agentId: string}) : Promise<Array<ITransactionDetails>> {
        try {
            const txns: ITransaction[] = await this.TokenCollection.find({agentId: agentId})
                .sort({timestamp: -1})
                .toArray();
            
            return txns.map((txn: ITransaction) => ({
                trx: txn,
                totalValueSOL: txn.action === 'buy' ? txn.amountOut : txn.amountIn,    // Always the SOL amount (spent in buy, received in sell)
                tokenAmount: txn.action === 'buy' ? txn.amountIn : txn.amountOut,       // Always the token amount (received in buy, sold in sell)
                pricePerToken: txn.executionPrice
            }));
        } catch(e) {
            console.log(e);
            return [] as Array<{trx: ITransaction, totalValueSOL: number, tokenAmount: number, pricePerToken: number}>
        }
    }

    /**
     * Calculate overall profit and loss for a user across all trades
     * @param agentId - The agent id
     * @returns Object containing total P&L, realized P&L, and unrealized P&L
     */
    async calculateOverallPnL({agentId}: {agentId: string}) : Promise<IOverallPnL> {
        try {
            const txns = await this.TokenCollection.find({agentId: agentId})
                .sort({timestamp: 1})
                .toArray();

            let totalRealizedPnL = 0;
            let totalUnrealizedPnL = 0;
            let totalSOLSpent = 0;
            let totalSOLReceived = 0;

            // Group transactions by mint to calculate P&L per token
            const mintGroups: {[key: string]: any[]} = {};
            
            txns.forEach((txn: any) => {
                if (!txn || !txn.mint) return;
                
                if (!mintGroups[txn.mint]) {
                    mintGroups[txn.mint] = [];
                }
                mintGroups[txn.mint]?.push(txn);

                // Track total SOL flow
                if (txn.action === 'buy' && txn.amountOut) {
                    totalSOLSpent += txn.amountOut;  // SOL spent in buy transaction
                } else if (txn.action === 'sell' && txn.amountIn) {
                    totalSOLReceived += txn.amountIn;  // SOL received in sell transaction
                }
            });

            // Calculate P&L for each mint
            for (const mint in mintGroups) {
                const mintTxns = mintGroups[mint];
                const pnl = await this.calculateMintPnL({agentId, mint});
                if (pnl) {
                    totalRealizedPnL += pnl.realizedPnL || 0;
                    totalUnrealizedPnL += pnl.unrealizedPnL || 0;
                }
            }

            return {
                totalPnL: totalRealizedPnL + totalUnrealizedPnL,
                realizedPnL: totalRealizedPnL,
                unrealizedPnL: totalUnrealizedPnL,
                totalSOLSpent,
                totalSOLReceived,
                netSOLFlow: totalSOLReceived - totalSOLSpent
            };
        } catch(e) {
            console.log(e);
            throw e;
        }
    }

    /**
     * Calculate profit and loss for a specific mint (realized and unrealized)
     * @param agentId - The agent id
     * @param mint - The token mint address
     * @returns Object containing realized and unrealized P&L
     */
    async calculateMintPnL({agentId, mint}: {agentId: string, mint: string}) : Promise<ITokenPnL> {
        try {
            const txns = await this.TokenCollection.find({
                agentId: agentId, 
                mint: mint
            }).sort({timestamp: 1}).toArray();

            if (!txns.length) {
                return {
                    realizedPnL: 0,
                    unrealizedPnL: 0,
                    totalTokensBought: 0,
                    totalTokensSold: 0,
                    averageBuyPrice: 0,
                    currentHoldings: 0,
                    investedAmount: 0,
                    receivedAmount: 0,
                    investedInCurrentHoldings: 0,
                    totalPnL: 0
                };
            }

            let totalTokensBought = 0;
            let totalTokensSold = 0;
            let totalSOLSpent = 0;
            let totalSOLReceived = 0;
            let realizedPnL = 0;

            // Process transactions to calculate realized P&L
            const buyQueue: Array<{amount: number, price: number, solSpent: number}> = [];

            txns.forEach((txn: any) => {
                if (txn.action === 'buy') {
                    totalTokensBought += txn.amountIn;   // tokens received
                    totalSOLSpent += txn.amountOut;      // SOL spent
                    buyQueue.push({
                        amount: txn.amountIn,            // tokens received
                        price: txn.executionPrice,
                        solSpent: txn.amountOut          // SOL spent
                    });
                } else if (txn.action === 'sell') {
                    totalTokensSold += txn.amountOut;     // tokens sold
                    totalSOLReceived += txn.amountIn;   // SOL received

                    // Calculate realized P&L using FIFO method
                    let tokensToSell = txn.amountOut;     // tokens sold
                    let solFromSale = txn.amountIn;     // SOL received
                    let costBasis = 0;

                    while (tokensToSell > 0 && buyQueue.length > 0) {
                        const buy = buyQueue[0];
                        if (!buy) break;
                        
                        const tokensFromThisBuy = Math.min(tokensToSell, buy.amount);
                        const proportionSold = tokensFromThisBuy / buy.amount;
                        
                        costBasis += buy.solSpent * proportionSold;
                        tokensToSell -= tokensFromThisBuy;
                        buy.amount -= tokensFromThisBuy;
                        buy.solSpent -= buy.solSpent * proportionSold;

                        if (buy.amount <= 0) {
                            buyQueue.shift();
                        }
                    }

                    realizedPnL += solFromSale - costBasis;
                }
            });

            // Calculate unrealized P&L for remaining holdings
            const currentHoldings = totalTokensBought - totalTokensSold;
            let unrealizedPnL = 0;
            let investedInCurrentHoldings = buyQueue.length > 0 ? buyQueue.reduce((sum, buy) => sum + buy.solSpent, 0) : 0;

            // if (currentHoldings > 0 && buyQueue.length > 0) {
            //     // Sum up the cost basis of remaining tokens
            //     investedInCurrentHoldings = buyQueue.reduce((sum, buy) => sum + buy.solSpent, 0);
                
            //     // Get current price to calculate unrealized P&L
            //     try {
            //         const tokenInfo = await this.solanaTracker.getToken(mint);
            //         if (tokenInfo?.pools?.[0]?.price?.quote) {
            //             const currentValue = currentHoldings * tokenInfo.pools[0].price.quote;
            //             unrealizedPnL = currentValue - investedInCurrentHoldings;
            //         }
            //     } catch (e) {
            //         console.log('Error fetching current price for unrealized P&L:', e);
            //     }
            // }

            const averageBuyPrice = totalTokensBought > 0 ? totalSOLSpent / totalTokensBought : 0;

            return {
                realizedPnL,
                unrealizedPnL,
                totalPnL: realizedPnL + unrealizedPnL,
                totalTokensBought,
                totalTokensSold,
                currentHoldings,
                averageBuyPrice,
                investedAmount: totalSOLSpent,
                receivedAmount: totalSOLReceived,
                investedInCurrentHoldings
            };
        } catch(e) {
            console.log(e);
            throw e;
        }
    }

    /**
     * Get overall trading statistics for a user
     * @param agentId - The agent id
     * @returns Object containing comprehensive trading stats
     */
    async getUserTradingStats({agentId}: {agentId: string}) : Promise<ITransactionStats> {
        try {
            const txns = await this.TokenCollection.find({agentId: agentId}).toArray();
            
            if (!txns.length) {
                return {
                    totalTrades: 0,
                    totalBuyTrades: 0,
                    totalSellTrades: 0,
                    totalSOLTraded: 0,
                    totalSOLSpent: 0,
                    totalSOLReceived: 0,
                    uniqueTokensTraded: 0,
                    averageTradeSize: 0,
                    totalFeesPaid: 0,
                    firstTradeDate: null,
                    lastTradeDate: null,
                    tradingPeriodDays: 0,
                    winRate: 0,
                    pnlStats: {
                        totalPnL: 0,
                        realizedPnL: 0,
                        unrealizedPnL: 0,
                        totalSOLSpent: 0,
                        totalSOLReceived: 0,
                        netSOLFlow: 0
                    }
                };
            }

            let totalBuyTrades = 0;
            let totalSellTrades = 0;
            let totalSOLSpent = 0;
            let totalSOLReceived = 0;
            let totalFeesPaid = 0;
            const uniqueMints = new Set();
            const timestamps = txns.map((txn: any) => txn.timestamp).filter(Boolean);

            txns.forEach((txn: any) => {
                uniqueMints.add(txn.mint);
                
                if (txn.action === 'buy') {
                    totalBuyTrades++;
                    totalSOLSpent += txn.amountOut;  // SOL spent in buy transaction
                } else if (txn.action === 'sell') {
                    totalSellTrades++;
                    totalSOLReceived += txn.amountIn;  // SOL received in sell transaction
                }
                
                if (txn.fees) {
                    totalFeesPaid += txn.fees;
                }
            });

            const totalSOLTraded = totalSOLSpent + totalSOLReceived;
            const totalTrades = txns.length;
            const averageTradeSize = totalTrades > 0 ? totalSOLTraded / totalTrades : 0;
            
            const firstTradeDate = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null;
            const lastTradeDate = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null;
            const tradingPeriodDays = firstTradeDate && lastTradeDate ? 
                Math.ceil((lastTradeDate.getTime() - firstTradeDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;

            // Get P&L data
            const pnlData = await this.calculateOverallPnL({agentId});
            //const { totalSOLSpent: pnlSOLSpent, totalSOLReceived: pnlSOLReceived, ...pnlStats } = pnlData || {};

            return {
                totalTrades,
                totalBuyTrades,
                totalSellTrades,
                totalSOLTraded,
                totalSOLSpent,
                totalSOLReceived,
                uniqueTokensTraded: uniqueMints.size,
                averageTradeSize,
                totalFeesPaid,
                firstTradeDate,
                lastTradeDate,
                tradingPeriodDays,
                winRate: totalSellTrades > 0 ? ((pnlData.realizedPnL || 0) > 0 ? 1 : 0) : 0, // Simplified win rate
                pnlStats: pnlData
            };
        } catch(e) {
            console.log(e);
            throw e;
        }
    }
    
}

interface PerformSwapOptions {
    fromToken: string;
    toToken: string;
    amount: number;
    slippage: number;
    payer: string;
    priorityFee: number;
}

export class AgentLedgerTools extends SolanaLedgerUtility {

    constructor() {
        super();
    }

    //PERFORM SWAP
    async performSwap({agentId, amount, action, privateKey, mint}:{agentId: string, amount: number, action: 'buy' | 'sell', privateKey: string, mint: string}) {
        try{
            //TODO: get credential for RPC SERVER
            
            await this.credentialManager.init();
            const secret = await this.credentialManager.getSecret(undefined, undefined, undefined, privateKey, false, true)
            
            //const ledger = await this.getLedgerByLedgerId({ledgerId});
            const keypair = Keypair.fromSecretKey(bs58.decode(secret.SOLANA_PRIVATE_KEY));

            const swapClient = new SolanaTrackerSwapClient({apiKey: process.env.SOLANA_TRACKER_API_KEY!, rpcUrl: process.env.SOLANA_RPC_URL!, privateKey: secret.SOLANA_PRIVATE_KEY})
            //const tnxs = await this.TokenCollection.find({mint: ledger.mint, agentId: agentId});
            let totalAmount = 0;

            if(action === 'sell'){
                const tokenBalance = await swapClient.getTokenBalance({mint: mint})
                
                if(!tokenBalance.status){
                    totalAmount = 0
                }else if(!tokenBalance.data) {
                    totalAmount = 0
                }else{
                    totalAmount = tokenBalance.data.balance;
                }   
                
            }else{
                totalAmount = amount;
            }

            if(totalAmount === 0){
                return {
                    success: false,
                    message: 'No token balance found',
                    data: null,
                }
            }

            const swapOptions: PerformSwapOptions = {
                fromToken: action === 'buy' ? 'So11111111111111111111111111111111111111112' : mint,
                toToken: action === 'buy' ? mint : 'So11111111111111111111111111111111111111112',
                amount: totalAmount,
                slippage: 30,
                payer: keypair.publicKey.toBase58(),
                priorityFee: 0.0005
            }

            const swapResult = await swapClient.performSwap(swapOptions);
            
            if(!swapResult.success){
                return {
                    success: false,
                    message: swapResult.message,
                    data: null,
                }
            }

            const swapResponse = swapResult.data?.swapResponse;

            const newTransaction = {
                id: uuidv4(),
                agentId,
                mint,
                action,
                amountIn: swapResponse?.rate?.amountIn || 0,
                amountOut: swapResponse?.rate?.amountOut || 0,
                executionPrice: swapResponse?.rate?.executionPrice || 0,
                status: 'success',
                transactionHash: swapResult.data?.txid || '',
                timestamp: Date.now(),
                fees: swapResponse?.rate?.fee || 0,
            }

            await this.addTransaction(newTransaction);
            return {
                success: true,
                message: 'Swap successful',
                data: {swapResponse, entryPrice: swapResponse?.rate?.executionPrice || 0},
            }
        }catch(e){
            console.log(e);
            throw e;
        }
    }
    
    //TRANSFER SOL
    async transferSOL({to, amount, privateKey}:{to: string, amount: number, privateKey: string}) : Promise<{success: boolean, message: string, data: {transactionHash: string} | null}> {
        
       try{
        await this.credentialManager.init();
        const secret = await this.credentialManager.getSecret(undefined, undefined, undefined, privateKey, false, true)
        
        const keypair = Keypair.fromSecretKey(bs58.decode(secret.SOLANA_PRIVATE_KEY));

        // Todo get user balance and check if enough balance
        const userBalance = await getSolBalance(keypair.publicKey);
        if(userBalance < amount){
            return {
                success: false,
                message: 'Insufficient balance',
                data: null,
            }
        }
    
        const solanaTransferService = new SolanaTransferService(process.env.SOLANA_RPC_URL!, keypair);
        const transactionHash = await solanaTransferService.transferSol(to, amount);

        return {
            success: true,
            message: 'SOL transfer successful',
            data: {transactionHash},
        }
       } catch(e){
        console.log(e);
        return {
            success: false,
            message: 'SOL transfer failed',
            data: null,
        }
       }
    }

    //TRANSFER TOKEN
    async transferToken({to, amount, privateKey, mint}:{to: string, amount: number, privateKey: string, mint: string}) : Promise<{success: boolean, message: string, data: {transactionHash: string} | null}> {
        try{
            await this.credentialManager.init();
            const secret = await this.credentialManager.getSecret(undefined, undefined, undefined, privateKey, false, true)
            
            const keypair = Keypair.fromSecretKey(bs58.decode(secret.SOLANA_PRIVATE_KEY));
            const swapClient = new SolanaTrackerSwapClient({apiKey: process.env.SOLANA_TRACKER_API_KEY!, rpcUrl: process.env.SOLANA_RPC_URL!, privateKey: secret.SOLANA_PRIVATE_KEY})

            const tokenBalance = await swapClient.getTokenBalance({mint: mint})
            if(!tokenBalance.status){
                return {
                    success: false,
                    message: 'Token balance not found',
                    data: null,
                }
            }

            if(!tokenBalance.data){

                return {
                    success: false,
                    message: 'Token balance not found',
                    data: null,
                }
            }

            if(tokenBalance.data.balance < amount){

                return {
                    success: false,
                    message: 'Insufficient token balance',
                    data: null,
                }
            }

            const solanaTransferService = new SolanaTransferService(process.env.SOLANA_RPC_URL!, keypair);
            const transactionHash = await solanaTransferService.transferSplToken(mint, to, amount);

            return {
                success: true,
                message: 'Token transfer successful',
                data: {transactionHash},
            }
        } catch(e){
            console.log(e);
            return {
                success: false,
                message: 'Token transfer failed',
                data: null,
            }
        }
    }   
    
}