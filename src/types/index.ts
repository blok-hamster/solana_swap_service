// Core trade job interfaces
export interface TradeJob {
  id: string;
  agentId: string;
  tradeType: 'buy' | 'sell' | 'research' | 'position_check';
  priority: 'high' | 'medium' | 'low';
  data: any;
  retryCount?: number;
  maxRetries?: number;
  createdAt: Date;
  scheduledAt?: Date;
}

export interface TradeQueueOptions {
  url: string;
  queueName: string;
  prefetch?: number;
  maxRetries?: number;
}

// Watch queue interfaces
export interface WatchJob {
  id: string;
  agentId: string;
  originalTradeId: string;
  tokenMint: string;
  entryPrice: number;
  currentPrice?: number;
  amount: number;
  privateKey: string;
  ledgerId: string;
  sellConditions: SellConditions;
  trailingStopLoss: TrailingStopLossConfig;
  executionData: any;
  status: 'active' | 'sold' | 'failed';
  createdAt: Date;
  lastChecked?: Date;
  retryCount?: number;
  maxRetries?: number;
}

export interface SellConditions {
  takeProfitPercentage?: number; // e.g., 50 for 50% profit
  stopLossPercentage?: number; // e.g., 20 for 20% loss
  trailingStopPercentage?: number; // e.g., 10 for 10% trailing stop
  maxHoldTimeMinutes?: number; // Auto-sell after X minutes
  customConditions?: any[]; // For future extensibility
}

export interface TrailingStopLossConfig {
  enabled: boolean;
  percentage: number; // e.g., 10 for 10% trailing stop
  takeProfitThreshold?: number; // Price threshold to activate trailing stop
  initialEntryPrice: number;
  highestPrice?: number; // Track the highest price reached
  isActivated?: boolean; // Whether trailing stop has been activated
}

export interface TradeWatchQueueOptions {
  url: string;
  queueName: string;
  prefetch?: number;
  maxRetries?: number;
  checkIntervalMs?: number; // How often to check prices
}

// Service configuration interfaces
export interface SwapServiceConfig {
  rabbitmqUrl?: string;
  enableWatchQueue?: boolean;
  tradeWorkerConfig?: Partial<TradeWorkerConfig>;
  watchWorkerConfig?: Partial<TradeWatchWorkerConfig>;
}

export interface TradeWorkerConfig {
  rabbitmqUrl: string;
  workerCount: number;
  queuePrefix: string;
  sequentialProcessing: boolean;
}

export interface TradeWatchWorkerConfig {
  rabbitmqUrl: string;
  workerCount: number;
  queuePrefix: string;
  checkIntervalMs: number;
  initialDelayMs: number;
}

// Queue request/response interfaces
export interface BuyTradeRequest {
  agentId: string;
  amount: number;
  privateKey: string;
  ledgerId: string;
  priority?: 'high' | 'medium' | 'low';
  watchConfig?: {
    takeProfitPercentage?: number;
    stopLossPercentage?: number;
    enableTrailingStop?: boolean;
    trailingPercentage?: number;
    maxHoldTimeMinutes?: number;
  };
}

export interface SellTradeRequest {
  agentId: string;
  amount: number;
  privateKey: string;
  ledgerId: string;
  priority?: 'high' | 'medium' | 'low';
}

export interface TradeResponse {
  success: boolean;
  tradeId?: string;
  message?: string;
  error?: string;
  data?: any;
}

export interface HealthCheckResponse {
  healthy: boolean;
  details: {
    tradeWorker: boolean;
    watchWorker: boolean;
    rabbitmq: boolean;
    timestamp: string;
  };
}

export interface SystemStats {
  tradeQueue: {
    pending: number;
    processing: number;
    failed: number;
  };
  watchQueue: {
    active: number;
    monitoring: number;
    sold: number;
  };
  uptime: number;
  timestamp: string;
}

// Solana specific interfaces
export interface SolanaSwapConfig {
  rpcUrl: string;
  apiKey?: string;
  slippagePercentage?: number;
  priorityFee?: number;
}

export interface SwapResult {
  success: boolean;
  signature?: string;
  txid?: string;
  transactionId?: string;
  error?: string;
  swapData?: any;
}

// Worker management interfaces
export interface AddWatchJobParams {
  agentId: string;
  originalTradeId: string;
  tokenMint: string;
  entryPrice: number;
  amount: number;
  privateKey: string;
  ledgerId: string;
  sellConditions: SellConditions;
  trailingStopLoss: TrailingStopLossConfig;
  executionData?: any;
} 