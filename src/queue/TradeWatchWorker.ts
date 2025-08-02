import { TradeWatchQueue } from './TradeWatchQueue';
import { 
  AddWatchJobParams, 
  TradeWatchWorkerConfig,
  SellConditions,
  TrailingStopLossConfig,
  WatchJob
} from '../types';
import { config } from 'dotenv';

config();

export class TradeWatchWorkerService {
  private static instance: TradeWatchWorkerService;
  private workers: TradeWatchQueue[] = [];
  private config: TradeWatchWorkerConfig;
  private isRunning = false;

  constructor(config?: Partial<TradeWatchWorkerConfig>) {
    this.config = {
      rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
      workerCount: 1, // Single worker for sequential processing
      queuePrefix: 'solana_swap_watch',
      checkIntervalMs: 30000, // Check positions every 30 seconds
      initialDelayMs: 60000, // Wait 1 minute before starting to watch new positions
      ...config
    };
  }

  public static getInstance(config?: Partial<TradeWatchWorkerConfig>): TradeWatchWorkerService {
    if (!TradeWatchWorkerService.instance) {
      TradeWatchWorkerService.instance = new TradeWatchWorkerService(config);
    }
    return TradeWatchWorkerService.instance;
  }

  /**
   * Initialize and start all watch workers
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      console.log('Trade watch workers already running');
      return;
    }

    console.log('🚀 Starting Trade Watch Worker Service...');

    // Create watch workers for different monitoring scenarios
    const workerConfigs = [
      { 
        queueName: `${this.config.queuePrefix}_active`,
        checkIntervalMs: this.config.checkIntervalMs 
      },
      { 
        queueName: `${this.config.queuePrefix}_trailing`,
        checkIntervalMs: this.config.checkIntervalMs / 2 // Check trailing stops more frequently
      }
    ];

    for (const workerConfig of workerConfigs) {
      const worker = new TradeWatchQueue({
        url: this.config.rabbitmqUrl,
        queueName: workerConfig.queueName,
        prefetch: 1,
        maxRetries: 3,
        checkIntervalMs: workerConfig.checkIntervalMs
      });

      await worker.init();
      await worker.startWorker();
      this.workers.push(worker);
      console.log(`✅ Started watch worker for queue: ${workerConfig.queueName}`);
    }

    this.isRunning = true;
    console.log(`🎯 Trade Watch Worker Service started with ${this.workers.length} workers`);
  }

  /**
   * Add a buy trade to watch queue with monitoring configuration
   */
  public async addBuyTradeToWatch(
    agentId: string,
    originalTradeId: string,
    tokenMint: string,
    entryPrice: number,
    amount: number,
    privateKey: string,
    ledgerId: string,
    watchConfig: {
      takeProfitPercentage?: number;
      stopLossPercentage?: number;
      enableTrailingStop?: boolean;
      trailingPercentage?: number;
      maxHoldTimeMinutes?: number;
    }
  ): Promise<string> {
    if (!this.isRunning) {
      throw new Error('Watch workers not started');
    }

    // Create sell conditions from watch config
    const sellConditions: SellConditions = {
      takeProfitPercentage: watchConfig.takeProfitPercentage || 50,
      stopLossPercentage: watchConfig.stopLossPercentage || 20,
      trailingStopPercentage: watchConfig.trailingPercentage || 10,
      maxHoldTimeMinutes: watchConfig.maxHoldTimeMinutes || 1440 // 24 hours default
    };

    // Create trailing stop loss configuration
    const trailingStopLoss: TrailingStopLossConfig = {
      enabled: watchConfig.enableTrailingStop || true,
      percentage: watchConfig.trailingPercentage || 10,
      initialEntryPrice: entryPrice,
      isActivated: false
    };

    // Choose appropriate queue based on whether trailing stop is enabled
    const queueName = trailingStopLoss.enabled ? 
      `${this.config.queuePrefix}_trailing` : 
      `${this.config.queuePrefix}_active`;
    
    const worker = this.workers.find(w => w['options'].queueName === queueName);
    if (!worker) {
      throw new Error(`No watch worker found for queue: ${queueName}`);
    }

    const watchJobId = await worker.addWatchJob({
      agentId,
      originalTradeId,
      tokenMint,
      entryPrice,
      amount,
      privateKey,
      ledgerId,
      sellConditions,
      trailingStopLoss,
      executionData: {
        originalTradeId,
        addedToWatchAt: new Date()
      }
    });

    console.log(`📊 Added watch job ${watchJobId} for buy trade ${originalTradeId}`);
    return watchJobId;
  }

  /**
   * Add watch job with custom parameters
   */
  public async addWatchJob(params: AddWatchJobParams): Promise<string> {
    if (!this.isRunning) {
      throw new Error('Watch workers not started');
    }

    const worker = this.workers[0]; // Use first worker for custom jobs
    if (!worker) {
      throw new Error('No watch workers available');
    }

    return await worker.addWatchJob({
      agentId: params.agentId,
      originalTradeId: params.originalTradeId,
      tokenMint: params.tokenMint,
      entryPrice: params.entryPrice,
      amount: params.amount,
      privateKey: params.privateKey,
      ledgerId: params.ledgerId,
      sellConditions: params.sellConditions,
      trailingStopLoss: params.trailingStopLoss,
      executionData: params.executionData || {}
    });
  }

  /**
   * Mark watch jobs as sold to prevent duplicate processing
   */
  public async markWatchJobsAsSold(
    agentId: string, 
    tokenMint?: string, 
    ledgerId?: string
  ): Promise<{ marked: number; jobIds: string[] }> {
    // This is a placeholder - in a real implementation, you'd need to
    // coordinate with the queue system to mark jobs as sold
    console.log(`🏷️ Marking watch jobs as sold - Agent: ${agentId}, Token: ${tokenMint}, Ledger: ${ledgerId}`);
    
    // TODO: Implement actual job marking logic
    // This would involve sending messages to all workers to mark matching jobs as sold
    
    return { marked: 0, jobIds: [] };
  }

  /**
   * Remove watch jobs from processing queues
   */
  public async removeWatchJobsByToken(
    agentId: string, 
    tokenMint?: string, 
    ledgerId?: string
  ): Promise<{ removed: number; jobIds: string[] }> {
    console.log(`🗑️ Removing watch jobs - Agent: ${agentId}, Token: ${tokenMint}, Ledger: ${ledgerId}`);
    
    // TODO: Implement actual job removal logic
    // This would involve purging matching jobs from all worker queues
    
    return { removed: 0, jobIds: [] };
  }

  /**
   * Stop all watch workers gracefully
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping Trade Watch Worker Service...');

    for (const worker of this.workers) {
      await worker.close();
    }

    this.workers = [];
    this.isRunning = false;
    console.log('✅ Trade Watch Worker Service stopped');
  }

  /**
   * Get comprehensive system status
   */
  public async getStatus(): Promise<{
    running: boolean;
    workerCount: number;
    config: TradeWatchWorkerConfig;
    workers: Array<{
      queueName: string;
      healthy: boolean;
      stats: { active: number; monitoring: number; sold: number };
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
   * Get aggregated statistics across all watch workers
   */
  public async getStats(): Promise<{
    totalActive: number;
    totalMonitoring: number;
    totalSold: number;
    workerStats: Array<{
      queueName: string;
      active: number;
      monitoring: number;
      sold: number;
    }>;
  }> {
    let totalActive = 0;
    let totalMonitoring = 0;
    let totalSold = 0;
    const workerStats = [];

    for (const worker of this.workers) {
      const stats = await worker.getQueueStats();
      const queueName = worker['options'].queueName;
      
      totalActive += stats.active;
      totalMonitoring += stats.monitoring;
      totalSold += stats.sold;
      
      workerStats.push({
        queueName,
        active: stats.active,
        monitoring: stats.monitoring,
        sold: stats.sold
      });
    }

    return {
      totalActive,
      totalMonitoring,
      totalSold,
      workerStats
    };
  }

  /**
   * Health check for all watch workers
   */
  public async healthCheck(): Promise<{
    healthy: boolean;
    details: Array<{
      queueName: string;
      healthy: boolean;
    }>;
  }> {
    const details = await Promise.all(
      this.workers.map(async (worker) => ({
        queueName: worker['options'].queueName,
        healthy: await worker.healthCheck()
      }))
    );

    const healthy = this.isRunning && details.every(d => d.healthy);

    return {
      healthy,
      details
    };
  }

  /**
   * Restart all watch workers
   */
  public async restart(): Promise<void> {
    console.log('🔄 Restarting Trade Watch Worker Service...');
    await this.stop();
    await this.start();
    console.log('✅ Trade Watch Worker Service restarted');
  }

  /**
   * Get default watch configuration
   */
  public getDefaultWatchConfig(): {
    takeProfitPercentage: number;
    stopLossPercentage: number;
    enableTrailingStop: boolean;
    trailingPercentage: number;
    maxHoldTimeMinutes: number;
  } {
    return {
      takeProfitPercentage: 50,  // 50% profit target
      stopLossPercentage: 20,    // 20% maximum loss
      enableTrailingStop: true,  // Enable trailing stop-loss
      trailingPercentage: 10,    // 10% trailing stop
      maxHoldTimeMinutes: 1440   // 24 hours max hold time
    };
  }

  /**
   * Check if service is running
   */
  public get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get current configuration
   */
  public getConfig(): TradeWatchWorkerConfig {
    return { ...this.config };
  }
}

// Export singleton instance
export const tradeWatchWorkerService = TradeWatchWorkerService.getInstance(); 