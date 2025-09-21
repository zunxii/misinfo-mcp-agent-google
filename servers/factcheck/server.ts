import { FactCheckServer } from './FactCheckServer.js';

const server = new FactCheckServer();
server.run().catch(console.error);
