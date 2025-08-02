import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

export interface RpcRequestPayload {
  method: string;
  args: any;
  queue?: string;
}

export async function callRpcServer(requestPayload: RpcRequestPayload): Promise<any> {
  const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost');
  const channel = await connection.createChannel();
  const rpcQueue = 'rpc_queue';

  // Create an exclusive, temporary reply queue for this request
  const { queue: replyQueue } = await channel.assertQueue('', { exclusive: true });
  const correlationId = uuidv4();

  return new Promise<any>((resolve, reject) => {
    // Set up a consumer on the reply queue
    channel.consume(replyQueue, (msg) => {
      if (msg && msg.properties.correlationId === correlationId) {
        try {
          const response = JSON.parse(msg.content.toString());
          resolve(response);
        } catch (err) {
          reject(err);
        } finally {
          setTimeout(() => {
            connection.close();
          }, 500);
        }
      }
    }, { noAck: true });

    // Send the RPC request
    channel.sendToQueue(
      rpcQueue,
      Buffer.from(JSON.stringify(requestPayload)),
      { correlationId, replyTo: replyQueue }
    );
  });
}
