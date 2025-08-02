import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export interface Config {
  // Service Configuration
  nodeEnv: string;
  
  // RabbitMQ Configuration
  rabbitmqUrl: string;
  
  // Solana Configuration
  solanaRpcUrl: string;
  solanaTrackerApiKey: string | undefined;
  
  // BitQuery Configuration
  bitqueryApiKey: string | undefined;
  
  // Queue Configuration
  queuePrefix: string;
  enableWatchQueue: boolean;
  tradeCheckIntervalMs: number;
  initialWatchDelayMs: number;
  
  // Trade Configuration
  maxRetryAttempts: number;
  defaultTakeProfitPercentage: number;
  defaultStopLossPercentage: number;
  defaultTrailingPercentage: number;
  defaultMaxHoldTimeMinutes: number;
  
  // Logging Configuration
  logLevel: string;
  
  // Health Check Configuration
  healthCheckIntervalMs: number;
  
  // Monitoring Configuration
  enableMetrics: boolean;
  statusReportIntervalMs: number;
}

const config: Config = {
  // Service Configuration
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // RabbitMQ Configuration
  rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  
  // Solana Configuration
  solanaRpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  solanaTrackerApiKey: process.env.SOLANA_TRACKER_API_KEY,
  
  // BitQuery Configuration
  bitqueryApiKey: process.env.BITQUERY_API_KEY,
  
  // Queue Configuration
  queuePrefix: process.env.QUEUE_PREFIX || 'solana_swap',
  enableWatchQueue: process.env.ENABLE_WATCH_QUEUE !== 'false',
  tradeCheckIntervalMs: parseInt(process.env.TRADE_CHECK_INTERVAL_MS || '30000'),
  initialWatchDelayMs: parseInt(process.env.INITIAL_WATCH_DELAY_MS || '60000'),
  
  // Trade Configuration
  maxRetryAttempts: parseInt(process.env.MAX_RETRY_ATTEMPTS || '3'),
  defaultTakeProfitPercentage: parseInt(process.env.DEFAULT_TAKE_PROFIT_PERCENTAGE || '50'),
  defaultStopLossPercentage: parseInt(process.env.DEFAULT_STOP_LOSS_PERCENTAGE || '20'),
  defaultTrailingPercentage: parseInt(process.env.DEFAULT_TRAILING_PERCENTAGE || '10'),
  defaultMaxHoldTimeMinutes: parseInt(process.env.DEFAULT_MAX_HOLD_TIME_MINUTES || '1440'),
  
  // Logging Configuration
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // Health Check Configuration
  healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '300000'), // 5 minutes
  
  // Monitoring Configuration
  enableMetrics: process.env.ENABLE_METRICS === 'true',
  statusReportIntervalMs: parseInt(process.env.STATUS_REPORT_INTERVAL_MS || '600000') // 10 minutes
};

/**
 * Validate configuration
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Required configurations
  if (!config.rabbitmqUrl) {
    errors.push('RABBITMQ_URL is required');
  }
  
  if (!config.solanaRpcUrl) {
    errors.push('SOLANA_RPC_URL is required');
  }
  
  // Interval validations
  if (config.tradeCheckIntervalMs < 1000) {
    errors.push('TRADE_CHECK_INTERVAL_MS must be at least 1000ms');
  }
  
  if (config.initialWatchDelayMs < 0) {
    errors.push('INITIAL_WATCH_DELAY_MS must be non-negative');
  }
  
  if (config.healthCheckIntervalMs < 10000) {
    errors.push('HEALTH_CHECK_INTERVAL_MS should be at least 10000ms (10 seconds)');
  }
  
  if (config.statusReportIntervalMs < 30000) {
    errors.push('STATUS_REPORT_INTERVAL_MS should be at least 30000ms (30 seconds)');
  }
  
  // Trade configuration validations
  if (config.defaultTakeProfitPercentage <= 0) {
    errors.push('DEFAULT_TAKE_PROFIT_PERCENTAGE must be positive');
  }
  
  if (config.defaultStopLossPercentage <= 0) {
    errors.push('DEFAULT_STOP_LOSS_PERCENTAGE must be positive');
  }
  
  if (config.defaultTrailingPercentage <= 0) {
    errors.push('DEFAULT_TRAILING_PERCENTAGE must be positive');
  }
  
  if (config.defaultMaxHoldTimeMinutes <= 0) {
    errors.push('DEFAULT_MAX_HOLD_TIME_MINUTES must be positive');
  }
  
  // Warnings for optional but recommended configurations
  if (!config.solanaTrackerApiKey && config.nodeEnv === 'production') {
    console.warn('⚠️ SOLANA_TRACKER_API_KEY not set - price tracking may be limited');
  }
  
  if (!config.bitqueryApiKey && config.nodeEnv === 'production') {
    console.warn('⚠️ BITQUERY_API_KEY not set - price tracking may be limited');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get environment-specific configurations
 */
export function getEnvironmentConfig() {
  return {
    isDevelopment: config.nodeEnv === 'development',
    isProduction: config.nodeEnv === 'production',
    isTest: config.nodeEnv === 'test',
    
    // Development-specific settings
    ...(config.nodeEnv === 'development' && {
      verboseLogging: true,
      shortenedTimeouts: true,
      frequentStatusReports: true
    }),
    
    // Production-specific settings
    ...(config.nodeEnv === 'production' && {
      verboseLogging: false,
      shortenedTimeouts: false,
      frequentStatusReports: false
    })
  };
}

/**
 * Get queue configuration for workers
 */
export function getQueueConfig() {
  return {
    rabbitmqUrl: config.rabbitmqUrl,
    queuePrefix: config.queuePrefix,
    enableWatchQueue: config.enableWatchQueue,
    checkIntervalMs: config.tradeCheckIntervalMs,
    initialDelayMs: config.initialWatchDelayMs,
    maxRetries: config.maxRetryAttempts
  };
}

/**
 * Get default trade configuration
 */
export function getDefaultTradeConfig() {
  return {
    takeProfitPercentage: config.defaultTakeProfitPercentage,
    stopLossPercentage: config.defaultStopLossPercentage,
    enableTrailingStop: true,
    trailingPercentage: config.defaultTrailingPercentage,
    maxHoldTimeMinutes: config.defaultMaxHoldTimeMinutes
  };
}

/**
 * Print configuration summary (without sensitive data)
 */
export function printConfigSummary() {
  console.log('📋 Solana Swap Queue Worker Configuration:');
  console.log(`   🌐 Environment: ${config.nodeEnv}`);
  console.log(`   🐰 RabbitMQ: ${config.rabbitmqUrl.replace(/\/\/.*@/, '//***:***@')}`);
  console.log(`   ⛓️  Solana RPC: ${config.solanaRpcUrl}`);
  console.log(`   📊 Watch Queue: ${config.enableWatchQueue ? 'Enabled' : 'Disabled'}`);
  console.log(`   ⏱️  Check Interval: ${config.tradeCheckIntervalMs}ms`);
  console.log(`   📈 Default Take Profit: ${config.defaultTakeProfitPercentage}%`);
  console.log(`   📉 Default Stop Loss: ${config.defaultStopLossPercentage}%`);
  console.log(`   🎯 Default Trailing Stop: ${config.defaultTrailingPercentage}%`);
  console.log(`   📊 Status Reports: Every ${Math.floor(config.statusReportIntervalMs / 1000 / 60)} minutes`);
  console.log('');
}

export default config; 