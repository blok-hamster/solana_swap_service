import * as amqp from 'amqplib';
import { Connection, Channel, ConsumeMessage } from 'amqplib';
// import { 
//   AgentLedgerTools, 
//   BitquerySolanaAPI, 
// } from '../utils/solanaUtils';
import {AgentLedgerTools} from '../utils/ledgerUtility';
import {SolanaTrackerClient, SolanaTrackerSwapClient } from '../utils/solanaTracker';

import { 
  WatchJob, 
  SellConditions, 
  TrailingStopLossConfig, 
  TradeWatchQueueOptions 
} from '../types';

export class TradeWatchQueue {
  private connection: Connection | null = null;
  private channel: Channel | null = null;
  private readonly options: TradeWatchQueueOptions;
  private isClosing = false;
  private ledgerTools: AgentLedgerTools;
  private isProcessing = false;
  private processingQueue: WatchJob[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  //private bitquery: BitquerySolanaAPI;
  private messageMap = new Map<string, ConsumeMessage>();
  private solanaTracker: SolanaTrackerClient;
  private soldJobsCache: Map<string, { 
    timestamp: number; 
    agentId: string; 
    tokenMint?: string; 
    ledgerId?: string;
  }> = new Map();

  constructor(options: TradeWatchQueueOptions) {
    //this.bitquery = new BitquerySolanaAPI(process.env.BITQUERY_API_KEY! as string);
    this.solanaTracker = new SolanaTrackerClient();
    this.options = {
      prefetch: 1,
      maxRetries: 3,
      checkIntervalMs: 30000, // Check every 30 seconds by default
      ...options
    };
    this.ledgerTools = new AgentLedgerTools();
  }

  /**
   * Initialize the trade watch queue connection and setup
   */
  public async init(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.options.url) as unknown as Connection;
      this.setupConnectionHandlers();
      // @ts-ignore
      this.channel = await (this.connection as any).createChannel();
      
      // Assert main watch queue
      await this.channel!.assertQueue(this.options.queueName, { 
        durable: true,
        arguments: {
          'x-message-ttl': 86400000, // 24 hour TTL for watch jobs
        }
      });
      
      // Assert dead letter queue for failed watch jobs
      await this.channel!.assertQueue(`${this.options.queueName}_dlq`, { 
        durable: true 
      });
      
      // Assert delay queue for position rechecking
      await this.channel!.assertQueue(`${this.options.queueName}_delay`, {
        durable: true,
        arguments: {
          'x-message-ttl': this.options.checkIntervalMs, // Recheck interval
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': this.options.queueName
        }
      });

      // Assert sold jobs queue for cleanup coordination
      await this.channel!.assertQueue(`${this.options.queueName}_sold_jobs`, {
        durable: true,
        arguments: {
          'x-message-ttl': 600000, // 10 minutes TTL for sold job tracking
        }
      });

      // Set prefetch to 1 to ensure sequential processing
      this.channel!.prefetch(1);
      
      console.log(`✅ Trade watch queue ${this.options.queueName} initialized successfully`);
    } catch (error) {
      console.error('Failed to initialize trade watch queue:', error);
      throw error;
    }
  }

  /**
   * Setup connection handlers for reconnection
   */
  private setupConnectionHandlers(): void {
    if (!this.connection) return;

    this.connection.on('error', (error) => {
      console.error('TradeWatchQueue connection error:', error);
      if (!this.isClosing) {
        setTimeout(() => this.reconnect(), 5000);
      }
    });

    this.connection.on('close', () => {
      console.log('TradeWatchQueue connection closed');
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
      console.log('Attempting to reconnect TradeWatchQueue...');
      await this.init();
      await this.startWorker();
      console.log('TradeWatchQueue reconnected successfully');
    } catch (error) {
      console.error('Failed to reconnect TradeWatchQueue:', error);
      setTimeout(() => this.reconnect(), 10000);
    }
  }

  /**
   * Add a watch job to the queue
   */
  public async addWatchJob(job: Omit<WatchJob, 'id' | 'createdAt' | 'status'>): Promise<string> {
    if (!this.channel) {
      throw new Error('Trade watch queue not initialized');
    }

    const watchJob: WatchJob = {
      id: `watch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      status: 'active',
      retryCount: 0,
      maxRetries: this.options.maxRetries || 3,
      ...job
    };

    await this.channel.sendToQueue(
      this.options.queueName,
      Buffer.from(JSON.stringify(watchJob)),
      {
        persistent: true,
        messageId: watchJob.id
      }
    );

    console.log(`📊 Watch job ${watchJob.id} added for token ${job.tokenMint} (Agent: ${job.agentId})`);
    return watchJob.id;
  }

  /**
   * Start consuming watch jobs from the queue
   */
  public async startWorker(): Promise<void> {
    if (!this.channel) {
      throw new Error('Trade watch queue not initialized');
    }

    await this.channel.consume(this.options.queueName, async (msg) => {
      if (msg) {
        try {
          const job: WatchJob = JSON.parse(msg.content.toString());
          
          // Store message reference for later acknowledgment
          this.messageMap.set(job.id, msg);
          
          // Add job to processing queue
          await this.addToProcessingQueue(job);
          
        } catch (error) {
          console.error('Error parsing watch job:', error);
          this.channel!.nack(msg, false, false);
        }
      }
    });

    console.log(`🔄 Trade watch worker started for queue: ${this.options.queueName}`);
  }

  /**
   * Add job to internal processing queue
   */
  private async addToProcessingQueue(job: WatchJob): Promise<void> {
    this.processingQueue.push(job);
    
    if (!this.isProcessing) {
      this.processNextWatchJob();
    }
  }

  /**
   * Process watch jobs sequentially
   */
  private async processNextWatchJob(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const job = this.processingQueue.shift()!;
      const msg = this.messageMap.get(job.id);
      
      if (!msg) {
        console.error(`No message found for watch job ${job.id}`);
        continue;
      }

      try {
        console.log(`👀 Processing watch job ${job.id} for token ${job.tokenMint}`);
        const result = await this.processWatchJob(job);
        
        if (result.completed) {
          console.log(`✅ Watch job ${job.id} completed: ${result.reason}`);
          this.channel!.ack(msg);
        } else if (result.shouldRequeue) {
          console.log(`🔄 Requeueing watch job ${job.id} for continued monitoring`);
          await this.requeueWatchJob(job);
          this.channel!.ack(msg);
        } else {
          console.log(`❌ Watch job ${job.id} failed: ${result.error}`);
          await this.handleFailedWatchJob(job, msg, result.error);
        }
        
        this.messageMap.delete(job.id);
        
        // Small delay between processing jobs
        await this.sleep(1000);
        
      } catch (error) {
        console.error(`Error processing watch job ${job.id}:`, error);
        await this.handleFailedWatchJob(job, msg, error);
        this.messageMap.delete(job.id);
      }
    }

    this.isProcessing = false;
    
    if (this.processingQueue.length > 0) {
      setImmediate(() => this.processNextWatchJob());
    }
  }

  /**
   * Process a single watch job
   */
  private async processWatchJob(job: WatchJob): Promise<{
    completed: boolean;
    shouldRequeue: boolean;
    reason?: string;
    error?: any;
  }> {
    try {
      // Fix Date deserialization issues - convert string dates back to Date objects
      if (typeof job.createdAt === 'string') {
        job.createdAt = new Date(job.createdAt);
      }
      if (job.lastChecked && typeof job.lastChecked === 'string') {
        job.lastChecked = new Date(job.lastChecked);
      }

      // Check if job was already sold (avoid duplicate processing)
      if (job.status === 'sold') {
        return { completed: true, shouldRequeue: false, reason: 'Already sold' };
      }

      // Check if user still has token balance before continuing watch
      // Add grace period for new jobs since tokens may not appear immediately after purchase
      const jobAge = Date.now() - job.createdAt.getTime();
      const gracePeriodInMs = 3 * 60 * 1000; // 3 minutes grace period
      const isWithinGracePeriod = jobAge < gracePeriodInMs;
      
      console.log(`🔍 Checking token balance for agent ${job.agentId}, token: ${job.tokenMint} (Job age: ${Math.round(jobAge / 1000)}s)`);
      const balanceCheck = await this.checkTokenBalance(job);
      
      if (!balanceCheck.hasBalance) {
        if (isWithinGracePeriod) {
          // During grace period, just warn but continue monitoring
          console.log(`⚠️  No token balance found for job ${job.id}, but within grace period (${Math.round(jobAge / 1000)}s old). Continuing watch...`);
          console.log(`   - Balance check error: ${balanceCheck.error}`);
          console.log(`   - Will continue monitoring until grace period ends (${Math.round(gracePeriodInMs / 1000)}s)`);
          
          // Continue with price monitoring without balance validation
        } else {
          // After grace period, treat as position closure
          console.log(`❌ No token balance found for job ${job.id} after grace period: ${balanceCheck.error}`);
          
          // Mark job as sold since user no longer has tokens (likely sold manually)
          job.status = 'sold';
          
          return { 
            completed: true, 
            shouldRequeue: false, 
            reason: `Position closed - no token balance after grace period: ${balanceCheck.error}` 
          };
        }
      } else {
        // Update job amount with current balance if significantly different
        if (Math.abs(balanceCheck.currentBalance - job.amount) > 0.001) {
          console.log(`📊 Updating job ${job.id} amount from ${job.amount} to ${balanceCheck.currentBalance}`);
          job.amount = balanceCheck.currentBalance;
        }
        
        // Log when tokens appear for the first time if job is still relatively new
        if (isWithinGracePeriod && !job.lastChecked) {
          console.log(`🎉 Tokens confirmed for new job ${job.id} - balance appeared within grace period (${Math.round(jobAge / 1000)}s)`);
        }
      }

      // Get current token price
      const currentPrice = await this.getCurrentTokenPrice(job.tokenMint, job.agentId);
      if (currentPrice === null) {
        return { completed: false, shouldRequeue: true, error: 'Could not fetch price' };
      }

      job.currentPrice = currentPrice;
      job.lastChecked = new Date();

      // Update trailing stop loss if needed
      const trailingUpdate = this.updateTrailingStopLoss(job, currentPrice);
      if (trailingUpdate.activated && !job.trailingStopLoss.isActivated) {
        console.log(`🎯 Trailing stop loss activated for ${job.id} at price $${currentPrice}`);
        job.trailingStopLoss.isActivated = true;
      }

      // Check if any sell conditions are met
      const sellCheck = await this.checkSellConditions(job, currentPrice);
      
      if (sellCheck.shouldSell) {
        console.log(`🚨 Sell condition met for ${job.id}: ${sellCheck.reason}`);
        
        const sellResult = await this.executeSell(job, sellCheck.reason!);
        
        if (sellResult.success) {
          job.status = 'sold';
          return { completed: true, shouldRequeue: false, reason: sellCheck.reason! };
        } else {
          return { completed: false, shouldRequeue: false, error: sellResult.error };
        }
      }

      // Continue monitoring
      return { completed: false, shouldRequeue: true };

    } catch (error) {
      return { completed: false, shouldRequeue: false, error };
    }
  }

  /**
   * Update trailing stop loss logic
   */
  private updateTrailingStopLoss(job: WatchJob, currentPrice: number): { activated: boolean; updated: boolean } {
    const trailing = job.trailingStopLoss;
    let activated = false;
    let updated = false;

    // Initialize highest price if not set
    if (!trailing.highestPrice) {
      trailing.highestPrice = currentPrice;
      updated = true;
    }

    // Update highest price if current price is higher
    if (currentPrice > trailing.highestPrice) {
      trailing.highestPrice = currentPrice;
      updated = true;

      // Check if we should activate trailing stop (e.g., after reaching take profit threshold)
      const conditions = job.sellConditions;
      if (!trailing.isActivated && conditions.takeProfitPercentage) {
        const profitPercent = ((currentPrice - job.entryPrice) / job.entryPrice) * 100;
        
        if (profitPercent >= conditions.takeProfitPercentage) {
          trailing.isActivated = true;
          activated = true;
          updated = true;
          console.log(`🎯 Trailing stop activated for ${job.id} - Profit: ${profitPercent.toFixed(2)}%`);
        }
      }
    }

    return { activated, updated };
  }

  /**
   * Check if any sell conditions are met
   */
  private async checkSellConditions(job: WatchJob, currentPrice: number): Promise<{
    shouldSell: boolean;
    reason?: string;
  }> {
    const conditions = job.sellConditions;
    const entryPrice = job.entryPrice;
    
    // Calculate price change percentage
    const priceChangePercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // Check take profit (only if trailing stop hasn't been activated)
    if (!job.trailingStopLoss.isActivated && conditions.takeProfitPercentage && 
        priceChangePercent >= conditions.takeProfitPercentage) {
      return { shouldSell: true, reason: `Take profit reached: ${priceChangePercent.toFixed(2)}%` };
    }

    // Check stop loss
    if (conditions.stopLossPercentage && priceChangePercent <= -conditions.stopLossPercentage) {
      return { shouldSell: true, reason: `Stop loss triggered: ${priceChangePercent.toFixed(2)}%` };
    }

    // Check trailing stop loss
    if (job.trailingStopLoss.isActivated && job.trailingStopLoss.highestPrice) {
      const trailingStopPrice = job.trailingStopLoss.highestPrice * (1 - job.trailingStopLoss.percentage / 100);
      if (currentPrice <= trailingStopPrice) {
        const trailingChangePercent = ((currentPrice - job.trailingStopLoss.highestPrice) / job.trailingStopLoss.highestPrice) * 100;
        return { shouldSell: true, reason: `Trailing stop loss triggered: ${trailingChangePercent.toFixed(2)}%` };
      }
    }

    // Check max hold time
    if (conditions.maxHoldTimeMinutes) {
      const holdTimeMinutes = (Date.now() - job.createdAt.getTime()) / (1000 * 60);
      if (holdTimeMinutes >= conditions.maxHoldTimeMinutes) {
        return { shouldSell: true, reason: `Max hold time reached: ${holdTimeMinutes.toFixed(1)} minutes` };
      }
    }

    return { shouldSell: false };
  }

  /**
   * Execute sell order
   */
  private async executeSell(job: WatchJob, reason: string): Promise<{ success: boolean; error?: any; data?: any }> {
    try {
      const result = await this.ledgerTools.performSwap({
        agentId: job.agentId,
        amount: job.amount,
        action: 'sell',
        privateKey: job.privateKey,
        mint: job.tokenMint,
      });

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
      
    } catch (error) {
      return { success: false, error };
    }
  }

  /**
   * Mark related watch jobs as sold to prevent duplicate sells
   */
  private async markRelatedJobsAsSold(job: WatchJob): Promise<void> {
    try {
      // Add to sold jobs cache for future reference
      const cacheKey = `${job.agentId}-${job.tokenMint || job.ledgerId}`;
      this.soldJobsCache.set(cacheKey, {
        timestamp: Date.now(),
        agentId: job.agentId,
        tokenMint: job.tokenMint,
        ledgerId: job.ledgerId
      });

      // Send message to sold jobs queue for coordination with other instances
      if (this.channel) {
        await this.channel.sendToQueue(
          `${this.options.queueName}_sold_jobs`,
          Buffer.from(JSON.stringify({
            agentId: job.agentId,
            tokenMint: job.tokenMint,
            ledgerId: job.ledgerId,
            soldAt: new Date(),
            originalJobId: job.id
          })),
          { persistent: true }
        );
      }

      console.log(`📝 Marked related jobs as sold for agent ${job.agentId}, token ${job.tokenMint}`);
    } catch (error) {
      console.error('Error marking related jobs as sold:', error);
    }
  }

  /**
   * Get current token price
   */
  private async getCurrentTokenPrice(tokenMint: string, agentId: string): Promise<number | null> {
    try {
      // Try BitQuery first
    //   const bitqueryResult = await this.bitquery.getTokenPrice(tokenMint);
    //   if (bitqueryResult) {
    //     return bitqueryResult;
    //   }

      // Fallback to SolanaTracker
      const trackerResult = await this.solanaTracker.fetchTokenPrice(tokenMint);
      if (trackerResult) {
        return trackerResult.price;
      }

      console.warn(`Could not fetch price for token ${tokenMint}`);
      return null;
      
    } catch (error) {
      console.error(`Error fetching price for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Requeue watch job for continued monitoring
   */
  private async requeueWatchJob(job: WatchJob): Promise<void> {
    if (!this.channel) return;

    // Send to delay queue for reprocessing after interval
    await this.channel.sendToQueue(
      `${this.options.queueName}_delay`,
      Buffer.from(JSON.stringify(job)),
      { persistent: true }
    );
  }

  /**
   * Handle failed watch job
   */
  private async handleFailedWatchJob(job: WatchJob, msg: ConsumeMessage, error: any): Promise<void> {
    job.retryCount = (job.retryCount || 0) + 1;

    if (job.retryCount < (job.maxRetries || 3)) {
      console.log(`🔄 Retrying watch job ${job.id} (attempt ${job.retryCount}/${job.maxRetries})`);
      
      await this.channel!.sendToQueue(
        `${this.options.queueName}_delay`,
        Buffer.from(JSON.stringify(job)),
        { persistent: true }
      );
      
      this.channel!.ack(msg);
    } else {
      console.log(`💀 Watch job ${job.id} failed permanently, sending to DLQ`);
      
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
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue statistics
   */
  public async getQueueStats(): Promise<{ 
    active: number; 
    monitoring: number; 
    sold: number; 
  }> {
    if (!this.channel) {
      return { active: 0, monitoring: 0, sold: 0 };
    }

    try {
      const mainQueue = await this.channel.checkQueue(this.options.queueName);
      const dlq = await this.channel.checkQueue(`${this.options.queueName}_dlq`);
      
      return {
        active: mainQueue.messageCount,
        monitoring: this.processingQueue.length,
        sold: dlq.messageCount // Using DLQ as a proxy for completed jobs
      };
    } catch (error) {
      console.error('Error getting watch queue stats:', error);
      return { active: 0, monitoring: 0, sold: 0 };
    }
  }

  /**
   * Close the queue connection
   */
  public async close(): Promise<void> {
    this.isClosing = true;
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    if (this.channel) {
      await this.channel.close();
    }
    
    if (this.connection) {
      await (this.connection as any).close();
    }
    
    console.log(`🔌 Trade watch queue ${this.options.queueName} closed`);
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

  /**
   * Check if the user still has a balance for the token being watched
   */
  private async checkTokenBalance(job: WatchJob): Promise<{
    hasBalance: boolean;
    currentBalance: number;
    error?: string;
  }> {
    try {
      if (!job.privateKey || !job.tokenMint) {
        return { hasBalance: false, currentBalance: 0, error: 'Missing privateKey or tokenMint' };
      }

      // Create swap client to check token balance
      const swapClient = new SolanaTrackerSwapClient({
        apiKey: process.env.SOLANA_TRACKER_API_KEY!,
        rpcUrl: process.env.SOLANA_RPC_URL!,
        privateKey: job.privateKey
      });

      const balanceResult = await swapClient.getTokenBalance({ mint: job.tokenMint });

      if (!balanceResult.status || !balanceResult.data) {
        console.log(`⚠️  No token balance found for agent ${job.agentId}, token ${job.tokenMint}`);
        return { hasBalance: false, currentBalance: 0, error: 'No token balance found' };
      }

      const currentBalance = balanceResult.data.balance || 0;
      
      if (currentBalance <= 0) {
        console.log(`⚠️  Zero token balance for agent ${job.agentId}, token ${job.tokenMint}`);
        return { hasBalance: false, currentBalance: 0, error: 'Zero token balance' };
      }

      console.log(`✅ Token balance confirmed for ${job.agentId}: ${currentBalance} tokens`);
      return { hasBalance: true, currentBalance };

    } catch (error) {
      console.error(`❌ Error checking token balance for job ${job.id}:`, error);
      return { 
        hasBalance: false, 
        currentBalance: 0, 
        error: `Balance check failed: ${(error as Error).message}` 
      };
    }
  }
} 