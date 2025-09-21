import { WebFetchServer } from './WebFetchServer.js';

const server = new WebFetchServer();
server.run().catch(console.error);