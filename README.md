# Solana Swap Queue Worker Service

A dedicated queue worker microservice for handling Solana token swaps and trade monitoring via RabbitMQ, extracted from the RPC server for improved scalability and performance.

## 🚀 Features

### Trade Execution
- **Sequential Processing**: Ensures trades are executed in order to prevent race conditions
- **Priority Queues**: High, medium, and low priority trade processing
- **Retry Logic**: Automatic retry with exponential backoff for failed trades
- **Balance Validation**: Pre-trade validation to prevent insufficient balance errors

### Trade Monitoring & Watch Queue
- **Automatic Position Monitoring**: Successful trades are automatically added to monitoring
- **Trailing Stop-Loss**: Advanced trailing stop-loss implementation with dynamic adjustment
- **Multiple Sell Conditions**: Take profit, stop loss, time-based selling, and custom conditions
- **Real-time Price Tracking**: Continuous price monitoring with configurable intervals
- **Duplicate Sell Prevention**: Prevents multiple sells of the same position

### Queue-Based Architecture
- **Pure Queue Worker**: Communicates only through RabbitMQ queues
- **Independent Scaling**: Scale swap processing independently from the RPC server
- **No HTTP Exposure**: Secure internal service with no external endpoints
- **Health Monitoring**: Automatic status reporting and health checks
- **Graceful Shutdown**: Proper cleanup and connection management

## 📁 Project Structure

```
solana_swap_service/
├── src/
│   ├── config/
│   │   └── index.ts           # Configuration management
│   ├── queue/
│   │   ├── TradeQueue.ts      # Core trade execution queue
│   │   ├── TradeWorker.ts     # Trade worker service management
│   │   ├── TradeWatchQueue.ts # Position monitoring queue
│   │   ├── TradeWatchWorker.ts# Watch worker service management
│   │   └── SwapServiceManager.ts # Main service coordinator
│   ├── types/
│   │   └── index.ts           # TypeScript type definitions
│   ├── utils/
│   │   └── solanaUtils.ts     # Solana utility functions (placeholders)
│   └── index.ts               # Main service entry point
├── package.json
├── tsconfig.json
├── nodemon.json
└── README.md
```

## 🛠 Installation & Setup

### Prerequisites
- Node.js 18+ 
- RabbitMQ server running
- Solana RPC access
- Optional: Solana Tracker API key, BitQuery API key

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Build the service:**
```bash
npm run build
```

3. **Set up environment variables:**
```bash
# Create .env file with your configuration
```

### Environment Variables

```bash
# Service Configuration
NODE_ENV=production

# RabbitMQ Configuration
RABBITMQ_URL=amqp://localhost:5672

# Solana Configuration
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_TRACKER_API_KEY=your_api_key_here

# BitQuery Configuration (for price tracking)
BITQUERY_API_KEY=your_bitquery_api_key_here

# Queue Configuration
QUEUE_PREFIX=solana_swap
ENABLE_WATCH_QUEUE=true
TRADE_CHECK_INTERVAL_MS=30000
INITIAL_WATCH_DELAY_MS=60000

# Default Trade Settings
DEFAULT_TAKE_PROFIT_PERCENTAGE=50
DEFAULT_STOP_LOSS_PERCENTAGE=20
DEFAULT_TRAILING_PERCENTAGE=10
DEFAULT_MAX_HOLD_TIME_MINUTES=1440

# Monitoring Configuration
ENABLE_METRICS=true
STATUS_REPORT_INTERVAL_MS=600000    # 10 minutes
HEALTH_CHECK_INTERVAL_MS=300000     # 5 minutes
```

## 🚀 Running the Service

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

## 📡 Queue Communication

### Queue Structure

The service listens to and processes messages from the following RabbitMQ queues:

#### Trade Execution Queues
- `{QUEUE_PREFIX}_trades_high_priority` - High priority trades
- `{QUEUE_PREFIX}_trades_medium_priority` - Medium priority trades  
- `{QUEUE_PREFIX}_trades_low_priority` - Low priority trades

#### Watch Queue System
- `{QUEUE_PREFIX}_watch_active` - Active position monitoring
- `{QUEUE_PREFIX}_watch_trailing` - Trailing stop-loss monitoring

#### Dead Letter & Retry Queues
- `*_dlq` - Failed jobs for investigation
- `*_delay` - Retry queues with delays

### Message Formats

#### Buy Trade Message
```json
{
  "agentId": "agent123",
  "tradeType": "buy",
  "priority": "high",
  "data": {
    "agentId": "agent123",
    "amount": 100,
    "privateKey": "your_private_key",
    "ledgerId": "ledger456",
    "watchConfig": {
      "takeProfitPercentage": 50,
      "stopLossPercentage": 20,
      "enableTrailingStop": true,
      "trailingPercentage": 10,
      "maxHoldTimeMinutes": 1440
    }
  }
}
```

#### Sell Trade Message
```json
{
  "agentId": "agent123",
  "tradeType": "sell",
  "priority": "medium",
  "data": {
    "agentId": "agent123",
    "amount": 100,
    "privateKey": "your_private_key",
    "ledgerId": "ledger456",
    "mint": "token_mint_address"
  }
}
```

## 🔧 Integration with RPC Server

### Option 1: Direct Queue Publishing
```typescript
// In your RPC server
import amqp from 'amqplib';

class SolanaSwapClient {
  private connection: amqp.Connection;
  private channel: amqp.Channel;

  async executeBuyTrade(request: BuyTradeRequest): Promise<string> {
    const job = {
      agentId: request.agentId,
      tradeType: 'buy',
      priority: request.priority || 'medium',
      data: request
    };

    // Publish to appropriate queue based on priority
    const queueName = `solana_swap_trades_${request.priority || 'medium'}_priority`;
    
    await this.channel.sendToQueue(
      queueName,
      Buffer.from(JSON.stringify(job)),
      { persistent: true }
    );

    return job.id;
  }
}
```

### Option 2: Shared Queue Library
Create a shared library that both the RPC server and swap service can use for consistent queue communication.

## 🎯 Advanced Features

### Trailing Stop-Loss Logic

1. **Initial Setup**: Buy token with take profit and trailing stop settings
2. **Activation**: When price reaches take profit threshold, trailing activates
3. **Dynamic Adjustment**: Stop price updates as the token price increases
4. **Automatic Selling**: Sells when price drops by trailing percentage from highest point

### Example Trailing Stop Flow

```
Entry Price: $0.10
Take Profit: 50% ($0.15)
Trailing Stop: 10%

Price reaches $0.15 → Trailing activates
Price goes to $0.20 → Stop price becomes $0.18 (10% below $0.20)
Price drops to $0.18 → Automatic sell triggered
Result: 80% profit instead of 50%
```

### Watch Queue Cleanup

When a sell order is executed (manually or automatically), the system:
1. Detects the sell transaction
2. Finds related watch jobs for the same token
3. Prevents duplicate sells by marking jobs as sold
4. Ensures data consistency across the system

## 📊 Monitoring & Health Checks

### Automatic Status Reporting
The service automatically logs system status at configurable intervals:

```
📊 === System Status Report ===
🕐 Uptime: 45 minutes
💚 Health: Healthy
📈 Trade Queue: 0 pending, 1 processing, 0 failed
👀 Watch Queue: 5 active, 2 monitoring, 10 sold
🏃 Workers: 3 trade workers, 2 watch workers
===============================
```

### Key Metrics
- Trade queue: pending, processing, failed
- Watch queue: active, monitoring, sold
- Service uptime and health status
- RabbitMQ connection status
- Worker health across all queues

### Logging Configuration
```bash
# Enable detailed status reports
ENABLE_METRICS=true

# Status report frequency (10 minutes)
STATUS_REPORT_INTERVAL_MS=600000

# Health check frequency (5 minutes)
HEALTH_CHECK_INTERVAL_MS=300000
```

## 🔒 Security Considerations

- Private keys are handled securely within the queue system
- Queue messages are persistent and encrypted in transit
- No external HTTP endpoints exposed
- Internal service communication only through RabbitMQ
- Regular monitoring of dead letter queues recommended

## 🛠 Development

### Prerequisites for Development
- Node.js 18+
- TypeScript knowledge
- RabbitMQ running locally
- Understanding of Solana blockchain concepts

### Key Development Commands
```bash
npm run dev          # Development with hot reload
npm run build        # Build for production  
npm run type-check   # TypeScript type checking
npm test             # Run tests (when implemented)
```

### Local Development Setup
```bash
# 1. Start RabbitMQ locally
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management

# 2. Set up environment
cp .env.example .env
# Edit .env with your configuration

# 3. Install dependencies
npm install

# 4. Run in development mode
npm run dev
```

## 📝 TODO Items

The service includes placeholder implementations that need to be completed:

### High Priority
1. **Implement Solana Tools**: Adapt `AgentLedgerTools`, `SolanaTrackerSwapClient`, etc. from the RPC server
2. **Price Tracking**: Implement actual price fetching from BitQuery and SolanaTracker
3. **Balance Validation**: Complete balance checking logic
4. **Transaction Execution**: Implement actual swap execution

### Medium Priority
1. **Enhanced Error Handling**: More comprehensive error types and handling
2. **Structured Logging**: Implement proper logging with levels
3. **Queue Management**: Add queue purging and management commands
4. **Metrics Export**: Prometheus/StatsD metrics integration
5. **Configuration Validation**: Runtime configuration validation

### Low Priority
1. **Database Integration**: Optional persistence layer for job history
2. **Admin Commands**: Queue management via special admin messages
3. **Load Balancing**: Multiple worker instances with proper load distribution
4. **Docker Support**: Containerization with proper orchestration

## 🔧 Queue Management

### Manual Queue Operations
```bash
# Clear specific queue (development only)
rabbitmqctl purge_queue solana_swap_trades_high_priority

# List all queues
rabbitmqctl list_queues

# Monitor queue statistics  
rabbitmqctl list_queues name messages consumers
```

## 🤝 Contributing

1. Follow the existing code structure and patterns
2. Add proper TypeScript types for all new code
3. Include comprehensive error handling
4. Add JSDoc comments for public methods
5. Test queue operations with small amounts initially

## 📞 Support

For issues or questions:
1. Check the logs for detailed error messages
2. Verify RabbitMQ connection and queue setup
3. Ensure proper environment configuration
4. Monitor dead letter queues for failed jobs
5. Test with development/testnet before mainnet

## 🚨 Important Notes

- **This is a pure queue worker service - no HTTP endpoints**
- **Solana tool implementations need to be adapted from your RPC server**
- **Test thoroughly with small amounts before production use**
- **Monitor RabbitMQ performance and queue depths**
- **Always validate trades and balances before execution**
- **Service communicates only through RabbitMQ queues**

## 📈 Performance Considerations

- **Sequential Processing**: Prevents race conditions but may be slower
- **Queue Depth Monitoring**: Watch for queue buildup indicating processing issues
- **Memory Usage**: Monitor for memory leaks in long-running processes
- **RabbitMQ Health**: Ensure RabbitMQ has sufficient resources
- **Network Latency**: Consider RabbitMQ network latency in distributed setups 