import * as amqp from 'amqplib';
import { Connection, Channel, ConsumeMessage } from 'amqplib';
import { checkFeeBalance } from '../utils/solanaUtils';
import { AgentLedgerTools } from '../utils/ledgerUtility';
import { SolanaTrackerSwapClient } from '../utils/solanaTracker';
import { tradeWatchWorkerService } from './TradeWatchWorker';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { TradeJob, TradeQueueOptions } from '../types';
import { SecureEnvManager } from '../utils/credentialManager';

export class TradeQueue {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly options: TradeQueueOptions;
  private isClosing = false;
  private ledgerTools: AgentLedgerTools;
  private isProcessing = false;
  private processingQueue: TradeJob[] = [];

  constructor(options: TradeQueueOptions) {
    this.options = {
      prefetch: 1, // Force prefetch to 1 for sequential processing
      maxRetries: 1,
      ...options
    };
    this.ledgerTools = new AgentLedgerTools();
  }

  /**
   * Initialize the trade queue connection and setup
   */
  public async init(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.options.url) as unknown as Connection;
      this.setupConnectionHandlers();
      // @ts-ignore
      this.channel = await (this.connection as any).createChannel();
      
      // Assert main queue
      await this.channel!.assertQueue(this.options.queueName, { 
        durable: true,
        arguments: {
          'x-message-ttl': 3600000, // 1 hour TTL
        }
      });
      
      // Assert dead letter queue for failed trades
      await this.channel!.assertQueue(`${this.options.queueName}_dlq`, { 
        durable: true 
      });
      
      // Assert delay queue for retries
      await this.channel!.assertQueue(`${this.options.queueName}_delay`, {
        durable: true,
        arguments: {
          'x-message-ttl': 30000, // 30 seconds delay
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': this.options.queueName
        }
      });

      // Set prefetch to 1 to ensure sequential processing
      this.channel!.prefetch(1);
      console.log(`✅ Trade queue ${this.options.queueName} initialized successfully`);
    } catch (error) {
      console.error('Failed to initialize trade queue:', error);
      throw error;
    }
  }

  /**
   * Setup connection handlers for reconnection
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', (error) => {
      console.error('TradeQueue connection error:', error);
      if (!this.isClosing) {
        // Attempt to reconnect after a delay
        setTimeout(() => this.reconnect(), 5000);
      }
    });

    this.connection.on('close', () => {
      console.log('TradeQueue connection closed');
      if (!this.isClosing) {
        setTimeout(() => this.reconnect(), 5000);
      }
    });
  }

  /**
   * Reconnect to RabbitMQ
   */
  private async reconnect(): Promise<void> {
    try {
      console.log('Attempting to reconnect TradeQueue...');
      await this.init();
      await this.startWorker();
      console.log('TradeQueue reconnected successfully');
    } catch (error) {
      console.error('Failed to reconnect TradeQueue:', error);
      setTimeout(() => this.reconnect(), 10000);
    }
  }

  /**
   * Add a trade job to the queue
   */
  public async addTradeJob(job: Omit<TradeJob, 'id' | 'createdAt'>): Promise<string> {
    if (!this.channel) {
      throw new Error('Trade queue not initialized');
    }

    const tradeJob: TradeJob = {
      id: `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      retryCount: 0,
      maxRetries: this.options.maxRetries || 1,
      ...job
    };

    const priority = this.getPriorityValue(job.priority);
    
    await this.channel.sendToQueue(
      this.options.queueName,
      Buffer.from(JSON.stringify(tradeJob)),
      {
        persistent: true,
        priority,
        messageId: tradeJob.id
      }
    );

    console.log(`📝 Trade job ${tradeJob.id} added to queue with priority ${job.priority}`);
    return tradeJob.id;
  }

  /**
   * Get numeric priority value for RabbitMQ
   */
  private getPriorityValue(priority: 'high' | 'medium' | 'low'): number {
    switch (priority) {
      case 'high': return 10;
      case 'medium': return 5;
      case 'low': return 1;
      default: return 5;
    }
  }

  /**
   * Start consuming trade jobs from the queue (sequential processing)
   */
  public async startWorker(): Promise<void> {
    if (!this.channel) {
      throw new Error('Trade queue not initialized');
    }

    await this.channel.consume(this.options.queueName, async (msg) => {
      if (msg) {
        try {
          const job: TradeJob = JSON.parse(msg.content.toString());
          
          // Add job to processing queue and process sequentially
          await this.addToProcessingQueue(job, msg);
          
        } catch (error) {
          console.error('Error parsing trade job:', error);
          this.channel!.nack(msg, false, false); // Reject and don't requeue
        }
      }
    });

    console.log(`🔄 Trade worker started for queue: ${this.options.queueName}`);
  }

  /**
   * Add job to internal processing queue for sequential execution
   */
  private async addToProcessingQueue(job: TradeJob, msg: ConsumeMessage): Promise<void> {
    return new Promise((resolve) => {
      this.processingQueue.push(job);
      
      // Store the message reference with the job for later acknowledgment
      (job as any)._msg = msg;
      
      // Start processing if not already processing
      if (!this.isProcessing) {
        this.processNextJob();
      }
      
      resolve();
    });
  }

  /**
   * Process jobs sequentially from the internal queue
   */
  private async processNextJob(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const job = this.processingQueue.shift()!;
      const msg = (job as any)._msg as ConsumeMessage;
      
      try {
        console.log(`⚡ Processing trade job ${job.id} - Type: ${job.tradeType}, Priority: ${job.priority}`);
        const result = await this.processTradeJob(job);
        
        if (result.success) {
          console.log(`✅ Trade job ${job.id} completed successfully`);
          this.channel!.ack(msg);
        } else {
          console.log(`❌ Trade job ${job.id} failed:`, result.error);
          await this.handleFailedJob(job, msg, result.error);
        }
        
        // Add a small delay between jobs to prevent overwhelming the system
        await this.sleep(100);
        
      } catch (error) {
        console.error(`Error processing trade job ${job.id}:`, error);
        await this.handleFailedJob(job, msg, error);
      }
    }

    this.isProcessing = false;
    
    // Check if more jobs were added while processing
    if (this.processingQueue.length > 0) {
      setImmediate(() => this.processNextJob());
    }
  }

  /**
   * Handle failed job with retry logic
   */
  private async handleFailedJob(job: TradeJob, msg: ConsumeMessage, error: any): Promise<void> {
    job.retryCount = (job.retryCount || 0) + 1;

    if (job.retryCount < (job.maxRetries || 1)) {
      console.log(`🔄 Retrying job ${job.id} (attempt ${job.retryCount}/${job.maxRetries})`);
      
      // Send to delay queue for retry
      await this.channel!.sendToQueue(
        `${this.options.queueName}_delay`,
        Buffer.from(JSON.stringify(job)),
        { persistent: true }
      );
      
      this.channel!.ack(msg);
    } else {
      console.log(`💀 Job ${job.id} failed permanently, sending to DLQ`);
      
      // Send to dead letter queue
      const failedJob = { ...job, finalError: error, failedAt: new Date() };
      await this.channel!.sendToQueue(
        `${this.options.queueName}_dlq`,
        Buffer.from(JSON.stringify(failedJob)),
        { persistent: true }
      );
      
      this.channel!.ack(msg);
    }
  }

  /**
   * Sleep utility for adding delays between job processing
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Process different types of trade jobs
   */
  private async processTradeJob(job: TradeJob): Promise<{ success: boolean; error?: any; data?: any }> {
    try {
      switch (job.tradeType) {
        case 'buy':
          return await this.processBuyTrade(job);
        case 'sell':
          return await this.processSellTrade(job);
        case 'research':
          return await this.processTokenResearch(job);
        case 'position_check':
          return await this.processPositionCheck(job);
        default:
          throw new Error(`Unknown trade type: ${job.tradeType}`);
      }
    } catch (error) {
      return { success: false, error };
    }
  }

  /**
   * Validate balance before executing trade
   */
  private async validateTradeBalance(job: TradeJob): Promise<{
    success: boolean;
    message: string;
    balanceData?: any;
  }> {
    try {
      const { agentId, amount, privateKey, ledgerId, tradeType, mint } = job.data;
      const credentialManager = SecureEnvManager.getInstance();
      await credentialManager.init();
      // Decode private key to get public key
      const secret = await credentialManager.getSecret(undefined, undefined, undefined, privateKey, false, true)

      const keypair = Keypair.fromSecretKey(bs58.decode(secret.SOLANA_PRIVATE_KEY));
      const publicKey = keypair.publicKey;

      // Check basic SOL balance for fees
      const hasFeeBalance = await checkFeeBalance(publicKey);
      if (!hasFeeBalance) {
        return {
          success: false,
          message: 'Insufficient SOL balance for transaction fees. Minimum 0.001 SOL required.',
        };
      }

      // For buy trades, check SOL balance
      if (job.tradeType === 'buy') {
        const swapClient = new SolanaTrackerSwapClient({
          apiKey: process.env.SOLANA_TRACKER_API_KEY!,
          rpcUrl: process.env.SOLANA_RPC_URL!,
          privateKey: privateKey
        });

        // Get current SOL balance
        const connection = swapClient['connection']; // Access private connection
        const balance = await connection.getBalance(publicKey);
        const balanceInSol = balance / 1e9;

        if (balanceInSol < amount) {
          return {
            success: false,
            message: `Insufficient SOL balance for buy trade. Required: ${amount} SOL, Available: ${balanceInSol.toFixed(4)} SOL`,
            balanceData: { available: balanceInSol, required: amount }
          };
        }

        return {
          success: true,
          message: `Balance validated. Available: ${balanceInSol.toFixed(4)} SOL`,
          balanceData: { available: balanceInSol, required: amount }
        };
      }

      // For sell trades, check token balance
      if (job.tradeType === 'sell') {

        const tokenMint = mint;

        // Check token balance
        const swapClient = new SolanaTrackerSwapClient({
          apiKey: process.env.SOLANA_TRACKER_API_KEY!,
          rpcUrl: process.env.SOLANA_RPC_URL!,
          privateKey: privateKey
        });

        const tokenBalance = await swapClient.getTokenBalance({ mint: tokenMint });
        
        if (!tokenBalance.status || !tokenBalance.data || tokenBalance.data.balance < amount) {
          const availableBalance = tokenBalance.data?.balance || 0;
          return {
            success: false,
            message: `Insufficient token balance for sell trade. Required: ${amount}, Available: ${availableBalance}`,
            balanceData: { available: availableBalance, required: amount, tokenMint }
          };
        }

        return {
          success: true,
          message: `Token balance validated. Available: ${tokenBalance.data.balance}`,
          balanceData: { available: tokenBalance.data.balance, required: amount, tokenMint }
        };
      }

      return { success: true, message: 'Balance validated' };

    } catch (error) {
      console.error('Error validating trade balance:', error);
      return {
        success: false,
        message: `Balance validation failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Process buy trade
   */
  private async processBuyTrade(job: TradeJob): Promise<{ success: boolean; error?: any; data?: any }> {
    const { agentId, amount, privateKey, ledgerId, watchConfig, mint } = job.data;
    
    // Validate balance before executing the trade
    const balanceValidation = await this.validateTradeBalance({...job, tradeType: 'buy'});
    if (!balanceValidation.success) {
      console.error(`Buy trade ${job.id} failed balance validation:`, balanceValidation.message);
      return { 
        success: false, 
        error: balanceValidation.message,
        data: { balanceData: balanceValidation.balanceData }
      };
    }

    // Execute the buy trade using AgentLedgerTools
    const result = await this.ledgerTools.performSwap({
      agentId,
      amount,
      action: 'buy',
      privateKey,
      mint: mint,
    });

       // If buy trade was successful and watchConfig is provided, add it to the watch queue for monitoring
    if (result.success && !watchConfig) {
        console.log(`📊 No watchConfig provided for trade ${job.id}, skipping watch queue`);
      } else if (result.success && result.data && watchConfig) {
        try {
          console.log(`📊 watchConfig provided, adding trade ${job.id} to watch queue`);
          
          // Extract necessary data from the swap result
          const resultData = result.data ;
          const swapTokenMint = resultData.swapResponse?.rate?.quoteCurrency?.mint;
          const swapEntryPrice = resultData.entryPrice;
          const actualAmount = resultData.swapResponse?.rate?.amountIn || 0;
  
          // Use the original mint parameter as fallback if not in swap result
          const finalTokenMint = swapTokenMint || mint;
          
          // For entryPrice, we might need to calculate it or use a fallback
          let finalEntryPrice = swapEntryPrice;
          
          if (!finalEntryPrice) {
            console.warn(`⚠️ No entry price available for watch job. Trade: ${job.id}, Mint: ${finalTokenMint}`);
            console.log('Swap result data:', result.data);
            // Continue without adding to watch queue rather than creating a broken watch job
            console.log(`⏭️ Skipping watch queue for trade ${job.id} due to missing entry price`);
            return { success: result.success, data: result.data, error: result.success ? null : result.message };
          }
  
          console.log(`📝 Adding to watch queue - Mint: ${finalTokenMint}, EntryPrice: ${finalEntryPrice}, Amount: ${actualAmount}`);
  
          // Use provided watchConfig (no defaults since user explicitly provided it)
          const finalWatchConfig = watchConfig;
  
          // Add to watch queue with validated data
          const watchJobId = await tradeWatchWorkerService.addBuyTradeToWatch(
            agentId,
            job.id,
            finalTokenMint,  // Use extracted/validated token mint
            finalEntryPrice, // Use calculated/validated entry price
            actualAmount,
            privateKey,
            ledgerId,
            finalWatchConfig
          );
  
          console.log(`✅ Buy trade ${job.id} added to watch queue: ${watchJobId}`);
          
          // Add watch job ID to the result data
          (result.data as any).watchJobId = watchJobId;
          
        } catch (watchError) {
          console.error(`❌ Failed to add buy trade ${job.id} to watch queue:`, watchError);
          console.log('Watch error details:', {
            mint: mint,
            resultData: result.data,
            watchConfig: watchConfig
          });
          // Don't fail the trade because of watch queue issues
        }
      } 
  
      return { success: result.success, data: result.data, error: result.success ? null : result.message };
  }

  /**
   * Process sell trade
   */
  private async processSellTrade(job: TradeJob): Promise<{ success: boolean; error?: any; data?: any }> {
    const { agentId, amount, privateKey, mint, ledgerId } = job.data;
    
    // Validate balance before executing the trade
    const balanceValidation = await this.validateTradeBalance({...job, tradeType: 'sell', data: {...job.data, mint}});
    if (!balanceValidation.success) {
      console.error(`Sell trade ${job.id} failed balance validation:`, balanceValidation.message);
      return { 
        success: false, 
        error: balanceValidation.message,
        data: { balanceData: balanceValidation.balanceData }
      };
    }
    
    // Execute the sell trade
    const result = await this.ledgerTools.performSwap({
      agentId,
      amount,
      action: 'sell',
      privateKey,
      mint: mint,
    });

    // If sell trade was successful, clean up watch jobs
    if (result.success && (result as any).data) {
      const resultData = (result as any).data;
      const hasTransactionId = resultData.txid || resultData.transactionId || resultData.signature;
      const noErrors = result.success && (!(result as any).error);
      
      if (hasTransactionId && noErrors) {
        console.log(`💰 Sell trade ${job.id} completed successfully with transaction: ${hasTransactionId}`);
        
        try {
          // TODO: Clean up watch jobs - will need to integrate with watch worker service
          console.log(`🧹 Sell trade ${job.id} will clean up watch jobs (TODO: implement watch job cleanup)`);
        } catch (watchError) {
          console.error(`Error removing watch jobs for sell trade ${job.id}:`, watchError);
          // Don't fail the sell trade because of watch queue issues
        }
      }
    }

    return { success: result.success, data: (result as any).data, error: result.success ? null : (result as any).error };
  }

  /**
   * Process token research
   */
  private async processTokenResearch(job: TradeJob): Promise<{ success: boolean; error?: any; data?: any }> {
    const { agentId, tokenResearchParams, mints, updateLedgers } = job.data;
    
    // TODO: Implement token research functionality
    console.log(`🔍 Processing token research for job ${job.id}`);
    
    return {
      success: true,
      data: { message: 'Token research completed (placeholder implementation)' }
    };
  }

  /**
   * Process position check
   */
  private async processPositionCheck(job: TradeJob): Promise<{ success: boolean; error?: any; data?: any }> {
    const { agentId, privateKey, ledgerId } = job.data;
    
    // TODO: Implement position checking functionality
    console.log(`🎯 Processing position check for job ${job.id}`);
    
    return {
      success: true,
      data: { message: 'Position check completed (placeholder implementation)' }
    };
  }

  /**
   * Get queue statistics
   */
  public async getQueueStats(): Promise<{ pending: number; processing: number; failed: number }> {
    if (!this.channel) {
      return { pending: 0, processing: 0, failed: 0 };
    }

    try {
      const mainQueue = await this.channel.checkQueue(this.options.queueName);
      const dlq = await this.channel.checkQueue(`${this.options.queueName}_dlq`);
      
      return {
        pending: mainQueue.messageCount,
        processing: this.processingQueue.length,
        failed: dlq.messageCount
      };
    } catch (error) {
      console.error('Error getting queue stats:', error);
      return { pending: 0, processing: 0, failed: 0 };
    }
  }

  /**
   * Close the queue connection
   */
  public async close(): Promise<void> {
    this.isClosing = true;
    
    if (this.channel) {
      await this.channel.close();
    }
    
    if (this.connection) {
      await (this.connection as any).close();
    }
    
    console.log(`🔌 Trade queue ${this.options.queueName} closed`);
  }

  /**
   * Health check
   */
  public async healthCheck(): Promise<boolean> {
    try {
      return !!(this.connection && this.channel && !(this.connection as any).connection?.closed);
    } catch {
      return false;
    }
  }
} 