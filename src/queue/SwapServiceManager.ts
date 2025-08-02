import { tradeWorkerService } from './TradeWorker';
import { tradeWatchWorkerService } from './TradeWatchWorker';
import { 
  SwapServiceConfig, 
  BuyTradeRequest, 
  SellTradeRequest,
  TradeResponse,
  HealthCheckResponse,
  SystemStats
} from '../types';

export class SwapServiceManager {
  private static instance: SwapServiceManager;
  private config: SwapServiceConfig;
  private isInitialized = false;
  private startTime: number = Date.now();

  constructor(config?: SwapServiceConfig) {
    this.config = {
      rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
      enableWatchQueue: true,
      ...config
    };
  }

  public static getInstance(config?: SwapServiceConfig): SwapServiceManager {
    if (!SwapServiceManager.instance) {
      SwapServiceManager.instance = new SwapServiceManager(config);
    }
    return SwapServiceManager.instance;
  }

  /**
   * Initialize both trade execution and watch queue workers
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('Swap Service Manager already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing Queue Workers...');

      // Start trade execution worker
      await tradeWorkerService.start();
      console.log('✅ Trade execution workers started');

      // Start watch worker if enabled
      if (this.config.enableWatchQueue) {
        await tradeWatchWorkerService.start();
        console.log('✅ Trade watch workers started');
      }

      this.isInitialized = true;
      this.startTime = Date.now();
      console.log('🎯 All queue workers initialized successfully');

    } catch (error) {
      console.error('❌ Failed to initialize Queue Workers:', error);
      throw error;
    }
  }

  /**
   * Process a buy trade request (internal method for queue processing)
   */
  public async processBuyTradeFromQueue(request: BuyTradeRequest): Promise<TradeResponse> {
    try {
      if (!this.isInitialized) {
        throw new Error('Queue workers not initialized');
      }

      console.log(`💰 Processing buy trade request for agent ${request.agentId}`);

      // Execute the buy trade
      const {tradeId} = await tradeWorkerService.addBuyTrade(
        request.agentId,
        request.amount,
        request.privateKey,
        request.ledgerId, // Using ledgerId as mint for compatibility
        request.priority || 'medium',
        request.watchConfig
      );

      return {
        success: true,
        tradeId,
        message: 'Buy trade queued successfully',
        data: { tradeId, watchConfig: request.watchConfig }
      };

    } catch (error) {
      console.error('Error processing buy trade from queue:', error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to process buy trade'
      };
    }
  }

  /**
   * Process a sell trade request (internal method for queue processing)
   */
  public async processSellTradeFromQueue(request: SellTradeRequest): Promise<TradeResponse> {
    try {
      if (!this.isInitialized) {
        throw new Error('Queue workers not initialized');
      }

      console.log(`💸 Processing sell trade request for agent ${request.agentId}`);

      // Execute the sell trade
      const {tradeId} = await tradeWorkerService.addSellTrade(
        request.agentId,
        request.amount,
        request.privateKey,
        request.ledgerId, // Using ledgerId as mint for compatibility
        request.priority || 'medium'
      );

      return {
        success: true,
        tradeId,
        message: 'Sell trade queued successfully',
        data: { tradeId }
      };

    } catch (error) {
      console.error('Error processing sell trade from queue:', error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to process sell trade'
      };
    }
  }

  /**
   * Add position to watch queue (internal method for queue processing)
   */
  public async addToWatchQueueFromQueue(params: {
    agentId: string;
    originalTradeId: string;
    tokenMint: string;
    entryPrice: number;
    amount: number;
    privateKey: string;
    ledgerId: string;
    watchConfig: {
      takeProfitPercentage?: number;
      stopLossPercentage?: number;
      enableTrailingStop?: boolean;
      trailingPercentage?: number;
      maxHoldTimeMinutes?: number;
    };
  }): Promise<TradeResponse> {
    try {
      if (!this.isInitialized || !this.config.enableWatchQueue) {
        throw new Error('Watch service not available');
      }

      console.log(`👀 Adding position to watch queue for agent ${params.agentId}`);

      const watchJobId = await tradeWatchWorkerService.addBuyTradeToWatch(
        params.agentId,
        params.originalTradeId,
        params.tokenMint,
        params.entryPrice,
        params.amount,
        params.privateKey,
        params.ledgerId,
        params.watchConfig
      );

      return {
        success: true,
        tradeId: watchJobId,
        message: 'Position added to watch queue successfully',
        data: { watchJobId, watchConfig: params.watchConfig }
      };

    } catch (error) {
      console.error('Error adding to watch queue from queue:', error);
      return {
        success: false,
        error: (error as Error).message || 'Failed to add to watch queue'
      };
    }
  }

  /**
   * Get system health check
   */
  public async getHealthStatus(): Promise<HealthCheckResponse> {
    try {
      const tradeWorkerHealth = await tradeWorkerService.healthCheck();
      const watchWorkerHealth = this.config.enableWatchQueue ? 
        await tradeWatchWorkerService.healthCheck() : 
        { healthy: true, details: [] };

      const healthy = this.isInitialized && 
        tradeWorkerHealth.healthy && 
        watchWorkerHealth.healthy;

      return {
        healthy,
        details: {
          tradeWorker: tradeWorkerHealth.healthy,
          watchWorker: watchWorkerHealth.healthy,
          rabbitmq: tradeWorkerHealth.healthy, // Proxy for RabbitMQ health
          timestamp: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Health check failed:', error);
      return {
        healthy: false,
        details: {
          tradeWorker: false,
          watchWorker: false,
          rabbitmq: false,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Get system statistics
   */
  public async getSystemStats(): Promise<SystemStats> {
    try {
      const tradeStats = await tradeWorkerService.getStats();
      const watchStats = this.config.enableWatchQueue ? 
        await tradeWatchWorkerService.getStats() : 
        { totalActive: 0, totalMonitoring: 0, totalSold: 0, workerStats: [] };

      const uptime = Date.now() - this.startTime;

      return {
        tradeQueue: {
          pending: tradeStats.totalPending,
          processing: tradeStats.totalProcessing,
          failed: tradeStats.totalFailed
        },
        watchQueue: {
          active: watchStats.totalActive,
          monitoring: watchStats.totalMonitoring,
          sold: watchStats.totalSold
        },
        uptime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('Error getting system stats:', error);
      return {
        tradeQueue: { pending: 0, processing: 0, failed: 0 },
        watchQueue: { active: 0, monitoring: 0, sold: 0 },
        uptime: Date.now() - this.startTime,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get detailed status of all services
   */
  public async getDetailedStatus(): Promise<{
    initialized: boolean;
    uptime: number;
    tradeWorker: any;
    watchWorker: any;
    config: SwapServiceConfig;
  }> {
    const tradeWorkerStatus = await tradeWorkerService.getStatus();
    const watchWorkerStatus = this.config.enableWatchQueue ? 
      await tradeWatchWorkerService.getStatus() : 
      { running: false, workerCount: 0, workers: [] };

    return {
      initialized: this.isInitialized,
      uptime: Date.now() - this.startTime,
      tradeWorker: tradeWorkerStatus,
      watchWorker: watchWorkerStatus,
      config: this.config
    };
  }

  /**
   * Graceful shutdown of all services
   */
  public async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    console.log('🛑 Shutting down Queue Workers...');

    try {
      // Stop trade workers
      if (tradeWorkerService['isRunning']) {
        await tradeWorkerService.stop();
        console.log('✅ Trade worker service stopped');
      }

      // Stop watch workers
      if (this.config.enableWatchQueue && tradeWatchWorkerService.running) {
        await tradeWatchWorkerService.stop();
        console.log('✅ Watch worker service stopped');
      }

      this.isInitialized = false;
      console.log('🏁 Queue Workers shutdown complete');

    } catch (error) {
      console.error('Error during shutdown:', error);
      throw error;
    }
  }

  /**
   * Restart all services
   */
  public async restart(): Promise<void> {
    console.log('🔄 Restarting Queue Workers...');
    await this.shutdown();
    await this.initialize();
    console.log('✅ Queue Workers restarted');
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
    return tradeWatchWorkerService.getDefaultWatchConfig();
  }

  /**
   * Check if service is initialized
   */
  public get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current configuration
   */
  public getConfig(): SwapServiceConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (requires restart to take effect)
   */
  public updateConfig(newConfig: Partial<SwapServiceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('⚙️ Configuration updated (restart required for changes to take effect)');
  }

  /**
   * Get service metrics for monitoring
   */
  public async getMetrics(): Promise<{
    uptime: number;
    startTime: Date;
    initialized: boolean;
    health: HealthCheckResponse;
    stats: SystemStats;
  }> {
    const health = await this.getHealthStatus();
    const stats = await this.getSystemStats();

    return {
      uptime: Date.now() - this.startTime,
      startTime: new Date(this.startTime),
      initialized: this.isInitialized,
      health,
      stats
    };
  }

  /**
   * Log current system status (for monitoring/debugging)
   */
  public async logSystemStatus(): Promise<void> {
    const status = await this.getDetailedStatus();
    const health = await this.getHealthStatus();
    const stats = await this.getSystemStats();

    console.log('\n📊 === System Status Report ===');
    console.log(`🕐 Uptime: ${Math.floor(status.uptime / 1000 / 60)} minutes`);
    console.log(`💚 Health: ${health.healthy ? 'Healthy' : 'Unhealthy'}`);
    console.log(`📈 Trade Queue: ${stats.tradeQueue.pending} pending, ${stats.tradeQueue.processing} processing, ${stats.tradeQueue.failed} failed`);
    console.log(`👀 Watch Queue: ${stats.watchQueue.active} active, ${stats.watchQueue.monitoring} monitoring, ${stats.watchQueue.sold} sold`);
    console.log(`🏃 Workers: ${status.tradeWorker.workerCount} trade workers, ${status.watchWorker.workerCount} watch workers`);
    console.log('===============================\n');
  }
} 