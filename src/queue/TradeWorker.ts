import { TradeQueue } from './TradeQueue';
import { TradeJob, TradeQueueOptions, TradeWorkerConfig } from '../types';
import { config } from 'dotenv';

config();

export interface QueuedTradeParams {
  agentId: string;
  tradeType: 'buy' | 'sell';
  amount: number;
  privateKey: string;
  mint: string;
  priority?: 'high' | 'medium' | 'low';
  watchConfig?: {
    takeProfitPercentage?: number;
    stopLossPercentage?: number;
    enableTrailingStop?: boolean;
    trailingPercentage?: number;
    maxHoldTimeMinutes?: number;
  }
}

export class TradeWorkerService {
  private static instance: TradeWorkerService;
  private workers: TradeQueue[] = [];
  private config: TradeWorkerConfig;
  private isRunning = false;

  constructor(config?: Partial<TradeWorkerConfig>) {
    this.config = {
      rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
      workerCount: 1, // Reduced to 1 for true sequential processing
      queuePrefix: 'solana_swap_trades',
      sequentialProcessing: true,
      ...config
    };
  }

  public static getInstance(config?: Partial<TradeWorkerConfig>): TradeWorkerService {
    if (!TradeWorkerService.instance) {
      TradeWorkerService.instance = new TradeWorkerService(config);
    }
    return TradeWorkerService.instance;
  }

  /**
   * Initialize and start all trade workers
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Trade workers already running');
      return;
    }

    console.log('🚀 Starting Trade Worker Service...');

    if (this.config.sequentialProcessing) {
      // Create a single worker for each priority level to ensure sequential processing
      const workerConfigs = [
        { queueName: `${this.config.queuePrefix}_high_priority`, prefetch: 1 },
        { queueName: `${this.config.queuePrefix}_medium_priority`, prefetch: 1 },
        { queueName: `${this.config.queuePrefix}_low_priority`, prefetch: 1 }
      ];

      for (const workerConfig of workerConfigs) {
        const worker = new TradeQueue({
          url: this.config.rabbitmqUrl,
          queueName: workerConfig.queueName,
          prefetch: 1, // Always 1 for sequential processing
          maxRetries: 0 // Changed from 3 to 0 - no retries for trade jobs
        });

        await worker.init();
        await worker.startWorker();
        this.workers.push(worker);
        console.log(`✅ Started trade worker for queue: ${workerConfig.queueName}`);
      }
    } else {
      // Original concurrent processing logic (if needed)
      const workerConfigs = [
        { queueName: `${this.config.queuePrefix}_high_priority`, prefetch: 1 },
        { queueName: `${this.config.queuePrefix}_medium_priority`, prefetch: 2 },
        { queueName: `${this.config.queuePrefix}_low_priority`, prefetch: 3 }
      ];

      for (let i = 0; i < this.config.workerCount; i++) {
        const workerConfig = workerConfigs[i % workerConfigs.length];
        
        if (!workerConfig) continue;
        
        const worker = new TradeQueue({
          url: this.config.rabbitmqUrl,
          queueName: `${workerConfig.queueName}_${i}`,
          prefetch: workerConfig.prefetch,
          maxRetries: 0 // Changed from 3 to 0 - no retries for trade jobs
        });

        await worker.init();
        await worker.startWorker();
        this.workers.push(worker);
        console.log(`✅ Started trade worker ${i} for queue: ${workerConfig.queueName}_${i}`);
      }
    }

    this.isRunning = true;
    console.log(`🎯 Trade Worker Service started with ${this.workers.length} workers`);
  }

  /**
   * Add a trade job to the appropriate queue based on priority
   */
  public async addTradeJob(job: Omit<TradeJob, 'id' | 'createdAt'>): Promise<{success: boolean, tradeId: string}> {
    if (!this.isRunning) {
      throw new Error('Trade workers not started');
    }

    // Select worker based on priority
    const queueName = `${this.config.queuePrefix}_${job.priority}_priority`;
    const worker = this.workers.find(w => w['options'].queueName === queueName);
    
    if (!worker) {
      throw new Error(`No worker found for priority: ${job.priority}`);
    }

    const tradeId = await worker.addTradeJob(job);
    console.log(`📤 Trade job ${tradeId} queued with priority ${job.priority}`);
    return {success: true, tradeId: tradeId};
  }

  /**
   * Add a buy trade job - RPC Server compatibility method
   * Delegates to addTradeJob with proper structure
   */
  public async addBuyTrade(
    agentId: string,
    amount: number,
    privateKey: string,
    mint: string,
    priority: 'high' | 'medium' | 'low' = 'medium',
    watchConfig?: {
      takeProfitPercentage?: number;
      stopLossPercentage?: number;
      enableTrailingStop?: boolean;
      trailingPercentage?: number;
      maxHoldTimeMinutes?: number;
    }
  ): Promise<{success: boolean, tradeId: string}> {
    return await this.addTradeJob({
      agentId,
      tradeType: 'buy',
      priority,
      data: {
        agentId,
        amount,
        privateKey,
        mint,
        watchConfig
      }
    });
  }

  /**
   * Add a sell trade job - RPC Server compatibility method
   * Delegates to addTradeJob with proper structure
   */
  public async addSellTrade(
    agentId: string,
    amount: number,
    privateKey: string,
    mint: string,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<{success: boolean, tradeId: string}> {
    return await this.addTradeJob({
      agentId,
      tradeType: 'sell',
      priority,
      data: {
        agentId,
        amount,
        privateKey,
        mint
      }
    });
  }

   /**
   * Batch queue multiple trades (they will still be processed sequentially)
   */
   async queueBatchTrades(trades: QueuedTradeParams[]): Promise<{
    success: boolean;
    results: Array<{
      success: boolean;
      jobId?: string;
      message: string;
      tradeIndex: number;
      queuePosition?: number;
    }>;
    message: string;
    totalQueued?: number;
  }> {
    const results = [];
    let successCount = 0;

    for (let i = 0; i < trades.length; i++) {
      const trade = trades[i];
      try {
        let result;
        if (trade?.tradeType === 'buy') {
          result = await this.addBuyTrade(trade.agentId, trade.amount, trade.privateKey, trade.mint, trade.priority, trade.watchConfig as any);
        } else if (trade?.tradeType === 'sell') {
          result = await this.addSellTrade(trade.agentId, trade.amount, trade.privateKey, trade.mint, trade.priority);
        } else {
          throw new Error(`Invalid trade type: ${trade?.tradeType}`);
        }

        results.push({
          ...result,
          tradeIndex: i,
          jobId: result.tradeId,
          message: result.success ? 'Trade queued successfully' : 'Failed to queue trade',
          queuePosition: i
        });

        if (result.success) {
          successCount++;
        }
      } catch (error:any) {
        results.push({
          success: false,
          message: `Failed to queue trade: ${error.message}`,
          tradeIndex: i
        });
      }
    }

    const finalStatus = tradeWorkerService.getDetailedStatus();

    return {
      success: successCount > 0,
      results,
      totalQueued: finalStatus.totalQueued,
      message: `Queued ${successCount}/${trades.length} trades successfully. Total in queue: ${finalStatus.totalQueued}`
    };
  }

  /**
   * Add a token research job - RPC Server compatibility method
   * Delegates to addTradeJob with proper structure
   */
  public async addTokenResearchJob(
    agentId: string,
    tokenResearchParams: any,
    mints?: string[],
    updateLedgers: boolean = true,
    priority: 'high' | 'medium' | 'low' = 'low'
  ): Promise<{success: boolean, tradeId: string}> {
    return await this.addTradeJob({
      agentId,
      tradeType: 'research',
      priority,
      data: {
        agentId,
        tokenResearchParams,
        mints,
        updateLedgers
      }
    });
  }

  /**
   * Add a position check job - RPC Server compatibility method
   * Delegates to addTradeJob with proper structure
   */
  public async addPositionCheckJob(
    agentId: string,
    sellParams?: any,
    priority: 'high' | 'medium' | 'low' = 'medium'
  ): Promise<{success: boolean, tradeId: string}> {
    return await this.addTradeJob({
      agentId,
      tradeType: 'position_check',
      priority,
      data: {
        agentId,
        sellParams
      }
    });
  }

  /**
   * Stop all workers gracefully
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping Trade Worker Service...');

    for (const worker of this.workers) {
      await worker.close();
    }

    this.workers = [];
    this.isRunning = false;
    console.log('✅ Trade Worker Service stopped');
  }

  /**
   * Health check - RPC Server compatibility method
   */
  public async healthCheck(): Promise<any> {
    try {
      const workerHealths = await Promise.all(
        this.workers.map(async (worker) => {
          const queueName = worker['options'].queueName;
          const healthy = await worker.healthCheck();
          return { queueName, healthy };
        })
      );

      const allHealthy = workerHealths.every(w => w.healthy) && this.isRunning;

      return {
        healthy: allHealthy,
        running: this.isRunning,
        workerCount: this.workers.length,
        workers: workerHealths,
        message: allHealthy ? 'All workers healthy' : 'Some workers unhealthy'
      };
    } catch (error) {
      return {
        healthy: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Get detailed processing status - RPC Server compatibility method
   */
  public getDetailedStatus(): any {
    const workerStatuses = this.workers.map((worker, index) => {
      // Safely check if getProcessingStatus method exists
      const status = (worker as any).getProcessingStatus ? (worker as any).getProcessingStatus() : {};
      return {
        workerIndex: index,
        queueName: worker['options']?.queueName || 'unknown',
        ...status
      };
    });

    // Calculate totals
    const totalProcessing = workerStatuses.reduce((sum, w) => sum + (w.processing || 0), 0);
    const totalQueued = workerStatuses.reduce((sum, w) => sum + (w.queued || 0), 0);

    return {
      sequentialMode: this.config.sequentialProcessing,
      totalProcessing,
      totalQueued,
      totalWorkers: this.workers.length,
      running: this.isRunning,
      config: {
        queuePrefix: this.config.queuePrefix,
        workerCount: this.config.workerCount
      },
      workers: workerStatuses
    };
  }

  /**
   * Get comprehensive system status
   */
  public async getStatus(): Promise<{
    running: boolean;
    workerCount: number;
    config: TradeWorkerConfig;
    workers: Array<{
      queueName: string;
      healthy: boolean;
      stats: { pending: number; processing: number; failed: number };
    }>;
  }> {
    const workers = await Promise.all(
      this.workers.map(async (worker) => {
        const queueName = worker['options'].queueName;
        const healthy = await worker.healthCheck();
        const stats = await worker.getQueueStats();
        
        return {
          queueName,
          healthy,
          stats
        };
      })
    );

    return {
      running: this.isRunning,
      workerCount: this.workers.length,
      config: this.config,
      workers
    };
  }

  /**
   * Get aggregated statistics across all workers - RPC Server compatibility method
   */
  public async getQueueStats(): Promise<any> {
    if (!this.isRunning) {
      throw new Error('Trade workers not started');
    }

    try {
      const stats = await Promise.all(
        this.workers.map(async (worker, index) => {
          try {
            const workerStats = await worker.getQueueStats();
            // Safely check if getProcessingStatus method exists
            const processingStatus = (worker as any).getProcessingStatus ? (worker as any).getProcessingStatus() : {};
            
            return { 
              workerIndex: index, 
              queueName: worker['options']?.queueName || 'unknown',
              ...workerStats,
              processingStatus
            };
          } catch (error) {
            return { workerIndex: index, error: (error as Error).message };
          }
        })
      );

      return {
        totalWorkers: this.workers.length,
        sequentialMode: this.config.sequentialProcessing,
        workers: stats,
        summary: this.calculateSummaryStats(stats)
      };
    } catch (error) {
      throw new Error(`Failed to get queue stats: ${(error as Error).message}`);
    }
  }

  /**
   * Calculate summary statistics - helper method
   */
  private calculateSummaryStats(stats: any[]): any {
    const totals = stats.reduce((acc, stat) => {
      if (!stat.error) {
        acc.pending += stat.pending || 0;
        acc.processing += stat.processing || 0;
        acc.failed += stat.failed || 0;
        acc.completed += stat.completed || 0;
      }
      return acc;
    }, { pending: 0, processing: 0, failed: 0, completed: 0 });

    return {
      ...totals,
      healthyWorkers: stats.filter(s => !s.error).length,
      totalWorkers: stats.length
    };
  }

  /**
   * Get aggregated statistics across all workers
   */
  public async getStats(): Promise<{
    totalPending: number;
    totalProcessing: number;
    totalFailed: number;
    workerStats: Array<{
      queueName: string;
      pending: number;
      processing: number;
      failed: number;
    }>;
  }> {
    const workerStats = await Promise.all(
      this.workers.map(async (worker) => {
        const queueName = worker['options'].queueName;
        const stats = await worker.getQueueStats();
        
        return {
          queueName,
          pending: stats.pending || 0,
          processing: stats.processing || 0,
          failed: stats.failed || 0
        };
      })
    );

    const totals = workerStats.reduce(
      (acc, stats) => ({
        totalPending: acc.totalPending + stats.pending,
        totalProcessing: acc.totalProcessing + stats.processing,
        totalFailed: acc.totalFailed + stats.failed
      }),
      { totalPending: 0, totalProcessing: 0, totalFailed: 0 }
    );

    return {
      ...totals,
      workerStats
    };
  }
}

// Export singleton instance
export const tradeWorkerService = TradeWorkerService.getInstance(); 