import { SwapServiceManager } from './queue/SwapServiceManager';
import { RpcServer } from './Rpc/Rpc';
import config, { validateConfig, printConfigSummary } from './config';

// Initialize and start the queue worker service
async function startService() {
  try {
    console.log('🚀 Starting Solana Swap Queue Worker Service...\n');
    
    // Print configuration summary
    printConfigSummary();
    
    // Validate configuration
    const validation = validateConfig();
    if (!validation.valid) {
      console.error('❌ Configuration validation failed:');
      validation.errors.forEach(error => console.error(`   - ${error}`));
      process.exit(1);
    }
    console.log('✅ Configuration validated successfully\n');

    const rpcServer = RpcServer.getInstance({
      url: config.rabbitmqUrl,
      queue: 'sol_swap_rpc_queue',
      prefetch: 1
    });
    await rpcServer.start();
        
    // Initialize the swap service manager (queue workers only)
    const swapManager = SwapServiceManager.getInstance({
      rabbitmqUrl: config.rabbitmqUrl,
      enableWatchQueue: config.enableWatchQueue
    });

    console.log("swap manager", swapManager)
    
    await swapManager.initialize();
    console.log('✅ Swap Service Manager initialized\n');
    
    console.log('🎯 Queue Worker Service ready to process trades!');
    console.log('📊 Listening for trade requests on RabbitMQ queues:');
    console.log(`   - Trade queues: ${config.queuePrefix}_*_priority`);
    if (config.enableWatchQueue) {
      console.log(`   - Watch queues: ${config.queuePrefix}_watch_*`);
    }
    console.log('\n✨ Service is running - press Ctrl+C to stop\n');

    // Set up periodic status reporting for monitoring
    if (config.enableMetrics) {
      setupStatusReporting(swapManager);
    }

    // Set up periodic health checks
    setupHealthCheckLogging(swapManager);

  } catch (error) {
    console.error('❌ Failed to start Solana Swap Queue Worker Service:', error);
    process.exit(1);
  }
}

/**
 * Set up periodic status reporting for monitoring
 */
function setupStatusReporting(swapManager: SwapServiceManager) {
  console.log(`📊 Status reporting enabled - reports every ${Math.floor(config.statusReportIntervalMs / 1000 / 60)} minutes`);
  
  const statusInterval = setInterval(async () => {
    try {
      await swapManager.logSystemStatus();
    } catch (error) {
      console.error('❌ Error in status reporting:', error);
    }
  }, config.statusReportIntervalMs);

  // Clear interval on shutdown
  process.on('SIGTERM', () => clearInterval(statusInterval));
  process.on('SIGINT', () => clearInterval(statusInterval));
}

/**
 * Set up periodic health check logging
 */
function setupHealthCheckLogging(swapManager: SwapServiceManager) {
  const healthInterval = setInterval(async () => {
    try {
      const health = await swapManager.getHealthStatus();
      if (!health.healthy) {
        console.warn('⚠️ Health check failed:', health.details);
      }
    } catch (error) {
      console.error('❌ Health check error:', error);
    }
  }, config.healthCheckIntervalMs);

  // Clear interval on shutdown
  process.on('SIGTERM', () => clearInterval(healthInterval));
  process.on('SIGINT', () => clearInterval(healthInterval));
}

// Handle graceful shutdown
async function gracefulShutdown(signal: string) {
  console.log(`\n🛑 ${signal} received, shutting down gracefully...`);
  
  try {
    const swapManager = SwapServiceManager.getInstance();
    
    if (swapManager.initialized) {
      console.log('🔄 Shutting down queue workers...');
      
      // Log final status before shutdown
      if (config.enableMetrics) {
        console.log('📊 Final status report before shutdown:');
        await swapManager.logSystemStatus();
      }
      
      await swapManager.shutdown();
      console.log('✅ Queue workers shut down successfully');
    }
    
    console.log('🏁 Graceful shutdown complete');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Start the service
if (require.main === module) {
  startService();
}

export default startService; 