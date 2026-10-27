import { EventEmitter } from 'node:events';

// Barramento interno de eventos de domínio. Os serviços publicam aqui sem conhecer
// o transporte; o módulo de tempo real (Socket.io) assina e repassa aos clientes.
// Em produção isso seria Redis Pub/Sub, NATS ou Kafka para escalar horizontalmente.
export const bus = new EventEmitter();
bus.setMaxListeners(50);
